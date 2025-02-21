const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
    res.send(`
        <html>
            <body>
                <h1>Hi, this works?</h1>
            </body>
        </html>
    `);
});

app.get('/api/delay/:ms', (req, res) => {
  const delay = parseInt(req.params.ms) || 100;
  setTimeout(() => {
    res.json({ 
      message: 'Response after delay',
      requested_delay: delay,
      instance_id: process.env.HOSTNAME || 'local'
    });
  }, delay);
});

app.get('/api/cpu/:seconds', (req, res) => {
  const seconds = parseInt(req.params.seconds) || 1;
  const start = Date.now();
  
  // Simple CPU-intensive operation
  while (Date.now() - start < seconds * 1000) {
    Math.random() * Math.random();
  }
  
  res.json({
    message: 'CPU intensive task completed',
    seconds_requested: seconds,
    instance_id: process.env.HOSTNAME || 'local'
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});