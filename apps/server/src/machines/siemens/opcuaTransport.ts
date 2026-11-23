import { ClientTCP_transport, type IClientTransportFactory, type IHelloAckLimits } from 'node-opcua-transport';

/**
 * The size limits of an OPC UA connection to a control, so that a broken control, or a different device at its address,
 * cannot fill the memory of a Pi with one reply (F-15, as #91 did for the other machine types).
 *
 * Chatter asks for small replies: about 15 values in one read, the endpoints with their certificates, and the alarm
 * events. Each is some kilobytes. 4 MB is much more than that, and a Pi with many machines still has the memory for it.
 * 512 chunks let a control with the smallest chunk that OPC UA allows (8 KB) send a reply of 4 MB.
 */
export const OPCUA_TRANSPORT_LIMITS: Required<IHelloAckLimits> = {
  maxMessageSize: 4 * 1024 * 1024,
  maxChunkCount: 512,
  receiveBufferSize: 64 * 1024,
  sendBufferSize: 64 * 1024,
};

/** The smaller of the two values. In OPC UA, 0 means "no limit", so 0 gives the limit of Chatter. */
function smaller(control: number, limit: number): number {
  return control > 0 ? Math.min(control, limit) : limit;
}

/**
 * The settings of the Acknowledge message of the control, with no value above the limits of Chatter.
 * node-opcua uses these values as the limits of each reply, so without this, the control would set its own limits.
 */
export function limitReplySettings(control: IHelloAckLimits): IHelloAckLimits {
  return {
    maxMessageSize: smaller(control.maxMessageSize, OPCUA_TRANSPORT_LIMITS.maxMessageSize),
    maxChunkCount: smaller(control.maxChunkCount, OPCUA_TRANSPORT_LIMITS.maxChunkCount),
    receiveBufferSize: smaller(control.receiveBufferSize, OPCUA_TRANSPORT_LIMITS.receiveBufferSize),
    sendBufferSize: smaller(control.sendBufferSize, OPCUA_TRANSPORT_LIMITS.sendBufferSize),
  };
}

/**
 * The TCP transport of node-opcua, with the limits of Chatter.
 * Chatter sends its limits in the Hello message (transportSettings), and a good control keeps to them. But node-opcua
 * takes the limits of each reply from the Acknowledge message of the control, and with 0 it takes 64 MB and 1000 chunks.
 * So the transport also lowers the values of the Acknowledge message to the limits of Chatter.
 */
class LimitedClientTransport extends ClientTCP_transport {
  override setLimits(limits: IHelloAckLimits): void {
    super.setLimits(limitReplySettings(limits));
  }
}

/** Give this to OPCUAClient.create, as transportFactory, with transportSettings: OPCUA_TRANSPORT_LIMITS */
export const limitedTransportFactory: IClientTransportFactory = {
  create: settings => new LimitedClientTransport(settings),
};
