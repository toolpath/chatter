/**
 * The HTTP port of an MTConnect agent when none is given.
 * 5000 is the agent default in the MTConnect reference agent (cppagent).
 * Port 7878 is the adapter's raw SHDR port, which does not answer HTTP.
 */
export const DEFAULT_MTCONNECT_PORT = 5000;

/** The OPC UA port of a SINUMERIK control (the OPC UA default) */
export const DEFAULT_OPCUA_PORT = 4840;
