const express = require('express');
const cluster = require('cluster');
const { Worker } = require('worker_threads');

// Track active workers for cleanup
const activeWorkers = new Set();

// Cluster setup for multiple workers
if (cluster.isMaster) {
  const workerCount = 2; // Force 2 workers even on t2.micro
  console.log(`Master process running on ${process.pid}`);
  
  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });

  // Log stats every 30 seconds
  setInterval(() => {
    const numWorkers = Object.keys(cluster.workers).length;
    console.log(`Active workers: ${numWorkers}`);
  }, 30000);

} else {
  const app = express();
  const port = process.env.PORT || 3000;
  
  // Basic middleware
  app.use(express.json());
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      pid: process.pid,
      activeWorkers: activeWorkers.size
    });
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
  
  // Delay endpoint with proper cleanup
  app.get('/api/delay/:ms', async (req, res) => {
    const delay = parseInt(req.params.ms) || 100;
    
    try {
      await new Promise((resolve) => setTimeout(resolve, delay));
      res.json({
        message: 'Response after delay',
        requested_delay: delay,
        actual_delay: delay,
        instance_id: process.env.HOSTNAME || 'local',
        pid: process.pid
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Request failed',
        details: error.message
      });
    }
  });
  
  // CPU intensive task with worker threads and proper cleanup
  app.get('/api/cpu/:seconds', async (req, res) => {
    const seconds = parseInt(req.params.seconds) || 1;
    let worker;
    
    try {
      worker = new Worker(`
        const { parentPort } = require('worker_threads');
        
        parentPort.on('message', (seconds) => {
          const start = Date.now();
          while (Date.now() - start < seconds * 1000) {
            Math.random() * Math.random();
          }
          parentPort.postMessage({
            duration: Date.now() - start
          });
        });
      `, { eval: true });
      
      // Track this worker
      activeWorkers.add(worker);
      
      worker.postMessage(seconds);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Worker timeout')), seconds * 1000 + 5000); // 5s grace period
      });
      
      const workerPromise = new Promise((resolve, reject) => {
        worker.on('message', resolve);
        worker.on('error', reject);
      });
      
      const result = await Promise.race([workerPromise, timeoutPromise]);
      
      res.json({
        message: 'CPU intensive task completed',
        seconds_requested: seconds,
        actual_duration_ms: result.duration,
        instance_id: process.env.HOSTNAME || 'local',
        pid: process.pid
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'CPU task failed',
        details: error.message
      });
    } finally {
      if (worker) {
        worker.terminate();
        activeWorkers.delete(worker);
      }
    }
  });
  
  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error(`Error [${process.pid}]:`, err);
    res.status(500).json({ 
      error: 'Server error',
      pid: process.pid
    });
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log(`Worker ${process.pid} shutting down...`);
    // Terminate all active workers
    for (const worker of activeWorkers) {
      worker.terminate();
    }
    process.exit(0);
  });
  
  app.listen(port, () => {
    console.log(`Worker ${process.pid} running on port ${port}`);
  });
}