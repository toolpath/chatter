import { describe, expect, it } from 'vitest';
import { limitedTransportFactory, limitReplySettings, OPCUA_TRANSPORT_LIMITS } from './opcuaTransport.js';

const MB = 1024 * 1024;

describe('the OPC UA reply limits', () => {
  it('are small enough for a Pi and large enough for each reply that Chatter asks for', () => {
    expect(OPCUA_TRANSPORT_LIMITS).toEqual({
      maxMessageSize: 4 * MB,
      maxChunkCount: 512,
      receiveBufferSize: 64 * 1024,
      sendBufferSize: 64 * 1024,
    });
  });

  it('keep the smaller values that the control sends', () => {
    const control = { maxMessageSize: MB, maxChunkCount: 16, receiveBufferSize: 8192, sendBufferSize: 8192 };
    expect(limitReplySettings(control)).toEqual(control);
  });

  it('replace a larger value that the control sends, so a control cannot make Chatter take a reply with no end', () => {
    expect(limitReplySettings({
      maxMessageSize: 0xffffffff, maxChunkCount: 1_000_000, receiveBufferSize: 16 * MB, sendBufferSize: 16 * MB,
    })).toEqual(OPCUA_TRANSPORT_LIMITS);
  });

  it('replace 0, which means "no limit" in OPC UA', () => {
    expect(limitReplySettings({ maxMessageSize: 0, maxChunkCount: 0, receiveBufferSize: 8192, sendBufferSize: 8192 }))
      .toMatchObject({ maxMessageSize: OPCUA_TRANSPORT_LIMITS.maxMessageSize, maxChunkCount: OPCUA_TRANSPORT_LIMITS.maxChunkCount });
  });

  it('go into the transport after the control acknowledges the connection', () => {
    const transport = limitedTransportFactory.create(OPCUA_TRANSPORT_LIMITS);
    // What the transport does with the Acknowledge message of the control
    (transport as unknown as { setLimits(limits: object): void }).setLimits({
      maxMessageSize: 0, maxChunkCount: 0, receiveBufferSize: 16 * MB, sendBufferSize: 16 * MB,
    });
    expect(transport).toMatchObject({
      maxMessageSize: 4 * MB, maxChunkCount: 512, receiveBufferSize: 64 * 1024, sendBufferSize: 64 * 1024,
    });
    expect(transport.getTransportSettings()).toEqual(OPCUA_TRANSPORT_LIMITS);
    transport.dispose();
  });
});
