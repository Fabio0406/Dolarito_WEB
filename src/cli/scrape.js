// Ejecuta una actualización única desde la terminal: `npm run scrape`
const config = require('../config');
const { RateService } = require('../services/rateService');

new RateService(config)
  .refresh('cli')
  .then((snapshot) => {
    console.table(
      [...snapshot.banks, ...snapshot.digital].map((b) => ({ banco: b.short, compra: b.buy, venta: b.sell, estado: b.status, error: b.error || '' })),
    );
    console.log('Oficial:', snapshot.official.value, `(${snapshot.official.source})`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
