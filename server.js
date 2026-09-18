import { createApp } from './src/app.js';
import { config } from './src/config.js';

const app = createApp();

app.listen(config.port, config.host, () => {
  const displayHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  console.log(`Cryox Gemini Drive: http://${displayHost}:${config.port}`);
  console.log(`Listening on ${config.host}:${config.port}. Set HOST explicitly only when remote access is intended.`);
  console.log('Plaintext uploads are processed in memory. Only encrypted vault envelopes are persisted locally.');
});
