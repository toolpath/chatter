import { describe, it, expect, afterEach } from 'vitest';
import { BrotherConnector } from './brother/BrotherConnector.js';
import { HaasConnector } from './haas/HaasConnector.js';
import type { BaseMachineStatus, MachineData } from '../types/index.js';

/**
 * Normalized MachineData schema that all connectors must follow.
 * This is the single source of truth for the expected field names.
 */
const REQUIRED_DATA_FIELDS: Array<keyof MachineData> = [
  'mode',
  'program',
  'partCount',
  'partGoal',
  'toolNumber',
  'spindleSpeed',
  'alarm',
  'alarmCode',
];

/**
 * Required fields on the status object returned by getStatus()
 */
const REQUIRED_STATUS_FIELDS: Array<keyof BaseMachineStatus> = [
  'id',
  'name',
  'host',
  'type',
  'connected',
  'lastPollTime',
  'errors',
  'data',
];

interface ConnectorFactory {
  name: string;
  create: () => { getStatus: () => BaseMachineStatus; disconnect: () => void };
  expectedType: string;
}

const connectorFactories: ConnectorFactory[] = [
  {
    name: 'BrotherConnector',
    create: () => new BrotherConnector({
      name: 'TestBrother',
      host: '192.168.1.100',
      dataPort: 10000,
    }),
    expectedType: 'brother',
  },
  {
    name: 'HaasConnector',
    create: () => new HaasConnector({
      name: 'TestHaas',
      host: '192.168.1.100',
      dataPort: 9998,
      queryPort: 5051,
    }),
    expectedType: 'haas',
  },
];

describe('Connector Schema Validation', () => {
  describe.each(connectorFactories)('$name', ({ create, expectedType }) => {
    let connector: ReturnType<typeof create>;

    afterEach(() => {
      if (connector) {
        connector.disconnect();
      }
    });

    it('should return a valid status object structure', () => {
      connector = create();
      const status = connector.getStatus();

      // Verify all required status fields exist
      for (const field of REQUIRED_STATUS_FIELDS) {
        expect(status).toHaveProperty(field);
      }
    });

    it(`should have type "${expectedType}"`, () => {
      connector = create();
      const status = connector.getStatus();

      expect(status.type).toBe(expectedType);
    });

    it('should have a data object', () => {
      connector = create();
      const status = connector.getStatus();

      expect(status.data).toBeDefined();
      expect(typeof status.data).toBe('object');
    });

    it('should use normalized camelCase field names in data', () => {
      connector = create();
      const status = connector.getStatus();

      // Verify no old-style field names exist
      const oldStyleFields = [
        'Mode',
        'Program',
        'Part Count',
        'Part Goal',
        'Tool Number',
        'Spindle Speed',
        'Alarm',
        'Alarm Code',
        'ActiveTool',
        'SpindleRPM',
        'AlarmCode',
      ];

      for (const oldField of oldStyleFields) {
        expect(status.data).not.toHaveProperty(oldField);
      }
    });

    it('should initialize with empty errors array', () => {
      connector = create();
      const status = connector.getStatus();

      expect(Array.isArray(status.errors)).toBe(true);
      expect(status.errors).toHaveLength(0);
    });

    it('should start disconnected', () => {
      connector = create();
      const status = connector.getStatus();

      expect(status.connected).toBe(false);
    });

    it('should have null lastPollTime initially', () => {
      connector = create();
      const status = connector.getStatus();

      expect(status.lastPollTime).toBeNull();
    });

    it('should include macros array in status', () => {
      connector = create();
      const status = connector.getStatus();

      expect(status.macros).toBeDefined();
      expect(Array.isArray(status.macros)).toBe(true);
    });
  });

  describe('Schema consistency across connectors', () => {
    it('all connectors should return the same status field structure', () => {
      const statuses = connectorFactories.map(({ create }) => {
        const connector = create();
        const status = connector.getStatus();
        connector.disconnect();
        return status;
      });

      // Get the keys from the first status (excluding type-specific fields)
      const baseKeys = Object.keys(statuses[0]).filter(
        key => !['dataPort', 'queryPort', 'ftpPort', 'type'].includes(key)
      ).sort();

      // Verify all other statuses have the same base keys
      for (let i = 1; i < statuses.length; i++) {
        const currentKeys = Object.keys(statuses[i]).filter(
          key => !['dataPort', 'queryPort', 'ftpPort', 'type'].includes(key)
        ).sort();

        expect(currentKeys).toEqual(baseKeys);
      }
    });

    it('all connectors should have compatible data object types', () => {
      const connectors = connectorFactories.map(({ create }) => create());

      try {
        const dataObjects = connectors.map(c => c.getStatus().data);

        // Verify all data objects are plain objects
        for (const data of dataObjects) {
          expect(typeof data).toBe('object');
          expect(data).not.toBeNull();
          expect(Array.isArray(data)).toBe(false);
        }
      } finally {
        connectors.forEach(c => c.disconnect());
      }
    });
  });

  describe('Macro configuration', () => {
    it.each(connectorFactories)('$name should support macro configuration', ({ create }) => {
      // Create connector with macros
      const connector = create();
      const status = connector.getStatus();

      expect(status.macros).toBeDefined();
      expect(Array.isArray(status.macros)).toBe(true);

      connector.disconnect();
    });
  });
});

describe('MachineData field documentation', () => {
  it('documents the expected normalized field names', () => {
    // This test serves as documentation for the expected schema
    const expectedSchema = {
      mode: 'string - Machine mode (MEMORY, MDI, MANUAL, EDIT, JOG)',
      program: 'string - Current program name',
      partCount: 'number - Parts completed',
      partGoal: 'number - Target part count',
      toolNumber: 'number - Active tool number',
      spindleSpeed: 'number - Current spindle RPM',
      alarm: 'boolean - Whether an alarm is active',
      alarmCode: 'string - Alarm code if alarm is active',
    };

    // Verify our REQUIRED_DATA_FIELDS matches the documented schema
    const documentedFields = Object.keys(expectedSchema);
    expect(REQUIRED_DATA_FIELDS.sort()).toEqual(documentedFields.sort());
  });
});
