import { configureLogging } from './logger.js';

// The tests do not write the server log. A test that checks the log uses captureLog() (testSupport.ts).
configureLogging({ sink: () => {} });
