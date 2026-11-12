import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import { BrotherConnector } from '../machines/brother/BrotherConnector.js';
import { HaasConnector } from '../machines/haas/HaasConnector.js';
import { MTConnectConnector } from '../machines/mtconnect/MTConnectConnector.js';
import { FanucConnector } from '../machines/fanuc/FanucConnector.js';
import { SiemensConnector } from '../machines/siemens/SiemensConnector.js';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import { MachineRegistry, type ConnectorClass } from './MachineRegistry.js';
import { PollScheduler } from './PollScheduler.js';
import {
  MachineRepository,
  isStoredMachineType,
  type MachineUpdateByType,
  type StoredMachineType,
} from './machineRepository.js';
import {
  applyBrotherUpdate,
  applyFanucUpdate,
  applyHaasUpdate,
  applyMTConnectUpdate,
  applySiemensUpdate,
  createMTConnectConnector,
  fieldsOfAddRequest,
  newBrotherMachine,
  newFanucMachine,
  newHaasMachine,
  newMTConnectMachine,
  newSiemensMachine,
  toFanucUpdate,
  toSiemensUpdate,
} from './machineSettings.js';
import type {
  AddMachineRequest,
  BaseMachineStatus,
  BrotherMachineConfig,
  BrotherMachineStatus,
  BrotherMachineUpdate,
  FanucMachineConfig,
  FanucMachineStatus,
  FanucMachineUpdate,
  HaasMachineConfig,
  HaasMachineStatus,
  HaasMachineUpdate,
  MTConnectMachineConfig,
  MTConnectMachineStatus,
  MTConnectMachineUpdate,
  SiemensMachineConfig,
  SiemensMachineStatus,
  SiemensMachineUpdate,
  UpdateMachineRequest,
} from '../types/index.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('poller');

type MachineDataItem = { label: string; value: string | number | boolean };

/** How to save and apply a settings change to one machine of one type */
interface StoredMachineUpdate<Type extends StoredMachineType, Connector extends BaseMachineConnector> {
  id: string;
  type: Type;
  connectorClass: ConnectorClass<Connector>;
  updates: MachineUpdateByType[Type];
  applyToConnector: (connector: Connector, updates: MachineUpdateByType[Type]) => void;
}

/** Something that keeps data of a machine, and must remove it when the machine is removed */
export interface MachineRemovalListener {
  removeMachine(machineId: string): void;
}

/** Something that must know when a user adds a machine, for example to give it the starter alert rules */
export interface MachineAddListener {
  machineAdded(machineId: string): void;
}

/** Something that saves the values of each poll, for example the machine history */
export interface PollRecorder extends MachineRemovalListener {
  record(connector: BaseMachineConnector): void;
}

/**
 * The machines the server watches.
 * It keeps the saved settings, the live connectors, and the poll timers in step.
 *
 * Events:
 *   'update'      the status of all machines, after each poll,
 *                 and after a machine is added, changed, or removed
 *   'machineData' the data items of one machine, when its connector sends them
 */
export class HardwarePoller extends EventEmitter {
  private readonly repository: MachineRepository;
  private readonly registry = new MachineRegistry();
  private readonly scheduler: PollScheduler;
  // True between start() and stop(). New machines start polling only while this is true.
  private running = false;
  private fanucMachinesLoaded = false;
  private readonly recorders: PollRecorder[] = [];
  private readonly removalListeners: MachineRemovalListener[] = [];
  private readonly addListeners: MachineAddListener[] = [];

  constructor(db: Database.Database) {
    super();
    this.repository = new MachineRepository(db);
    this.scheduler = new PollScheduler({
      afterPoll: connector => this.afterPoll(connector),
      connectingEnded: () => this.emitStatusUpdate(),
    });
  }

  async loadFromDatabase(): Promise<void> {
    const brotherMachines = this.repository.loadBrotherMachines();
    brotherMachines.forEach(config => this.register(new BrotherConnector(config)));
    log.info('Loaded machines from the database', { type: 'Brother', count: brotherMachines.length });

    this.loadOptionalTable('Haas', () => this.repository.loadHaasMachines(), config => new HaasConnector(config));
    this.loadOptionalTable('MTConnect', () => this.repository.loadMTConnectMachines(), createMTConnectConnector);
    this.loadOptionalTable('Siemens', () => this.repository.loadSiemensMachines(), config => new SiemensConnector(config));
    this.startFanucMachines();
  }

  /**
   * Load the saved FANUC machines, when the FOCAS library is there.
   * Runs again after an admin uploads the library, so the machines start without a restart.
   */
  startFanucMachines(): void {
    if (this.fanucMachinesLoaded) return;
    if (!FanucConnector.isAvailable()) {
      log.info('FANUC machines skipped', { reason: FanucConnector.getPlatformMessage() });
      return;
    }
    this.loadOptionalTable('FANUC', () => this.repository.loadFanucMachines(), config => new FanucConnector(config));
    this.fanucMachinesLoaded = true;
  }

  async addBrotherMachine(config: BrotherMachineConfig): Promise<BrotherMachineStatus> {
    const machine = newBrotherMachine(config);
    this.repository.insertBrother(machine);
    return this.statusOf(this.addConnector(new BrotherConnector(machine)));
  }

  async addHaasMachine(config: HaasMachineConfig): Promise<HaasMachineStatus> {
    const machine = newHaasMachine(config);
    this.repository.insertHaas(machine);
    return this.statusOf(this.addConnector(new HaasConnector(machine)));
  }

  async addMTConnectMachine(config: MTConnectMachineConfig): Promise<MTConnectMachineStatus> {
    const machine = newMTConnectMachine(config);
    this.repository.insertMTConnect(machine);
    return this.statusOf(this.addConnector(createMTConnectConnector(machine)));
  }

  async addFanucMachine(config: FanucMachineConfig): Promise<FanucMachineStatus> {
    if (!FanucConnector.isAvailable()) {
      throw new Error(FanucConnector.getPlatformMessage());
    }
    const machine = newFanucMachine(config);
    this.repository.insertFanuc(machine);
    return this.statusOf(this.addConnector(new FanucConnector(machine)));
  }

  async addSiemensMachine(config: SiemensMachineConfig): Promise<SiemensMachineStatus> {
    const machine = newSiemensMachine(config);
    this.repository.insertSiemens(machine);
    return this.addConnector(new SiemensConnector(machine)).getStatus();
  }

  /** Add a machine of any type, from a request to the API */
  async addMachine(request: AddMachineRequest): Promise<BaseMachineStatus> {
    const status = await this.addMachineOfType(request);
    this.notifyAddListeners(status.id);
    return status;
  }

  private async addMachineOfType(request: AddMachineRequest): Promise<BaseMachineStatus> {
    const config = fieldsOfAddRequest(request);
    switch (request.type) {
      case 'brother': return this.addBrotherMachine(config);
      case 'haas': return this.addHaasMachine(config);
      case 'mtconnect': return this.addMTConnectMachine(config);
      case 'fanuc': return this.addFanucMachine(config);
      case 'siemens': return this.addSiemensMachine(config);
    }
    throw new Error(`Unknown machine type: ${request.type}`);
  }

  async updateBrotherMachine(id: string, updates: BrotherMachineUpdate): Promise<BrotherMachineStatus | null> {
    const connector = this.updateStoredMachine({
      id, type: 'brother', connectorClass: BrotherConnector, updates, applyToConnector: applyBrotherUpdate,
    });
    return connector ? this.statusOf(connector) : null;
  }

  async updateHaasMachine(id: string, updates: HaasMachineUpdate): Promise<HaasMachineStatus | null> {
    const connector = this.updateStoredMachine({
      id, type: 'haas', connectorClass: HaasConnector, updates, applyToConnector: applyHaasUpdate,
    });
    return connector ? this.statusOf(connector) : null;
  }

  async updateMTConnectMachine(id: string, updates: MTConnectMachineUpdate): Promise<MTConnectMachineStatus | null> {
    const connector = this.updateStoredMachine({
      id, type: 'mtconnect', connectorClass: MTConnectConnector, updates, applyToConnector: applyMTConnectUpdate,
    });
    return connector ? this.statusOf(connector) : null;
  }

  async updateFanucMachine(id: string, updates: FanucMachineUpdate): Promise<FanucMachineStatus | null> {
    const connector = this.updateStoredMachine({
      id, type: 'fanuc', connectorClass: FanucConnector, updates, applyToConnector: applyFanucUpdate,
    });
    return connector ? this.statusOf(connector) : null;
  }

  async updateSiemensMachine(id: string, updates: SiemensMachineUpdate): Promise<SiemensMachineStatus | null> {
    const connector = this.updateStoredMachine({
      id, type: 'siemens', connectorClass: SiemensConnector, updates, applyToConnector: applySiemensUpdate,
    });
    return connector?.getStatus() ?? null;
  }

  /** Update a machine of any type. Each type uses only the fields it knows. */
  async updateMachine(id: string, updates: UpdateMachineRequest): Promise<BaseMachineStatus | null> {
    const connector = this.registry.get(id);
    if (connector instanceof BrotherConnector) return this.updateBrotherMachine(id, updates);
    if (connector instanceof HaasConnector) return this.updateHaasMachine(id, updates);
    if (connector instanceof MTConnectConnector) return this.updateMTConnectMachine(id, updates);
    if (connector instanceof FanucConnector) return this.updateFanucMachine(id, toFanucUpdate(updates));
    if (connector instanceof SiemensConnector) return this.updateSiemensMachine(id, toSiemensUpdate(updates));
    return null;
  }

  async removeMachine(id: string): Promise<boolean> {
    // Stop the timer first, so no new poll starts
    this.scheduler.stop(id);
    const connector = this.registry.remove(id);
    if (!connector) return false;

    try {
      connector.disconnect();
    } catch {
      // The connector may already be in a bad state, and the machine is removed all the same
    }
    if (isStoredMachineType(connector.type)) this.repository.delete(connector.type, id);
    this.notifyRemovalListeners(id);
    log.info('Machine removed', { machine: id, name: connector.name, type: connector.type });
    this.emitStatusUpdate();
    return true;
  }

  getConnector(id: string): BaseMachineConnector | undefined {
    return this.registry.get(id);
  }

  getBrotherMachines(): BrotherMachineStatus[] {
    return this.registry.ofType(BrotherConnector).map(connector => this.statusOf(connector));
  }

  getFanucMachines(): FanucMachineStatus[] {
    return this.registry.ofType(FanucConnector).map(connector => this.statusOf(connector));
  }

  getMachines(): BaseMachineStatus[] {
    return this.registry.all().map(connector => this.statusOf(connector));
  }

  getMachine(id: string): BaseMachineStatus | null {
    const connector = this.registry.get(id);
    return connector ? this.statusOf(connector) : null;
  }

  /** The status of all machines. The same as getMachines(). */
  getStatus(): BaseMachineStatus[] {
    return this.getMachines();
  }

  setInterval(ms: number): void {
    this.scheduler.setInterval(ms);
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  /** Save the values of each poll in the machine history too */
  addRecorder(recorder: PollRecorder): void {
    this.recorders.push(recorder);
    this.addRemovalListener(recorder);
  }

  /** Tell the listener each time a machine is removed */
  addRemovalListener(listener: MachineRemovalListener): void {
    this.removalListeners.push(listener);
  }

  /** Tell the listener each time a user adds a machine (not when the saved machines load at start) */
  addAddListener(listener: MachineAddListener): void {
    this.addListeners.push(listener);
  }

  /** Poll all machines one time, now (for tests) */
  async poll(): Promise<void> {
    await Promise.all(this.registry.all().map(connector => this.scheduler.pollNow(connector)));
    this.emitStatusUpdate();
  }

  start(): void {
    this.running = true;
    log.info('Starting poller', { intervalMs: this.scheduler.intervalMs });
    for (const connector of this.registry.all()) {
      this.scheduler.start(connector);
    }
    log.info('Polling machines', { count: this.registry.size });
  }

  stop(): void {
    this.running = false;
    this.scheduler.stopAll();
    for (const connector of this.registry.all()) {
      connector.disconnect();
    }
    log.info('Poller stopped');
  }

  /** Add a new machine, and start to poll it if the poller is running */
  private addConnector<T extends BaseMachineConnector>(connector: T): T {
    this.register(connector);
    log.info('Machine added', { machine: connector.id, name: connector.name, type: connector.type, host: connector.host });
    if (this.running) this.scheduler.start(connector);
    this.emitStatusUpdate();
    return connector;
  }

  private register(connector: BaseMachineConnector): void {
    connector.on('data', (dataItems: MachineDataItem[]) => {
      this.emit('machineData', { machineId: connector.id, machineType: connector.type, data: dataItems });
    });
    this.registry.add(connector);
  }

  /** Older databases may not have the table yet. Then skip that machine type. */
  private loadOptionalTable<Config>(
    typeName: string,
    loadConfigs: () => Config[],
    createConnector: (config: Config) => BaseMachineConnector,
  ): void {
    let configs: Config[];
    try {
      configs = loadConfigs();
    } catch {
      log.info('Machine table not found, skipping', { type: typeName });
      return;
    }
    const connectors = this.createEachConnector(typeName, configs, createConnector);
    connectors.forEach(connector => this.register(connector));
    log.info('Loaded machines from the database', { type: typeName, count: connectors.length });
    // Machines loaded after start() must start polling too
    if (this.running && connectors.length > 0) {
      connectors.forEach(connector => this.scheduler.start(connector));
      this.emitStatusUpdate();
    }
  }

  /** One bad saved machine must not stop the others from loading */
  private createEachConnector<Config>(
    typeName: string,
    configs: Config[],
    createConnector: (config: Config) => BaseMachineConnector,
  ): BaseMachineConnector[] {
    return configs.flatMap(config => {
      try {
        return [createConnector(config)];
      } catch (error) {
        log.error('Could not load a machine from the database', { type: typeName, error });
        return [];
      }
    });
  }

  /** Apply the change when the machine has this type. Null when it does not. */
  private updateStoredMachine<Type extends StoredMachineType, Connector extends BaseMachineConnector>(
    { id, type, connectorClass, updates, applyToConnector }: StoredMachineUpdate<Type, Connector>,
  ): Connector | null {
    const connector = this.registry.get(id);
    if (!(connector instanceof connectorClass)) return null;
    if (this.repository.update(type, id, updates)) {
      applyToConnector(connector, updates);
      this.emitStatusUpdate();
    }
    return connector;
  }

  private notifyAddListeners(id: string): void {
    for (const listener of this.addListeners) {
      try {
        listener.machineAdded(id);
      } catch (error) {
        // The machine is already added, so one listener that fails must not stop the others
        log.error('Could not set up the saved data of a new machine', { machine: id, error });
      }
    }
  }

  private notifyRemovalListeners(id: string): void {
    for (const listener of this.removalListeners) {
      try {
        listener.removeMachine(id);
      } catch (error) {
        // The machine is already gone, so one listener that fails must not stop the others
        log.error('Could not remove the saved data of a machine', { machine: id, error });
      }
    }
  }

  /** The status of the machine, and whether Chatter still tries to reach it for the first time */
  private statusOf<Status extends BaseMachineStatus>(connector: { id: string; getStatus(): Status }): Status {
    return { ...connector.getStatus(), connecting: this.scheduler.isConnecting(connector.id) };
  }

  /** True while the machine has had no good poll yet, for at most the connecting time */
  isConnecting(id: string): boolean {
    return this.scheduler.isConnecting(id);
  }

  private afterPoll(connector: BaseMachineConnector): void {
    this.recorders.forEach(recorder => recorder.record(connector));
    this.emitStatusUpdate();
  }

  private emitStatusUpdate(): void {
    this.emit('update', this.getStatus());
  }
}
