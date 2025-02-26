const express = require('express');
const cluster = require('cluster');
const { Worker } = require('worker_threads');
const { performance, PerformanceObserver } = require('perf_hooks');

// Track active workers for cleanup
const activeWorkers = new Set();

// Memory stats tracking
let gcStats = {
  collections: 0,
  gcTime: 0,
  lastGcDuration: 0,
  lastCollection: null
};

// Setup GC performance observer if GC is exposed
if (global.gc) {
  // Create performance observer for garbage collection
  const obs = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    
    entries.forEach(entry => {
      if (entry.entryType === 'gc') {
        gcStats.collections++;
        gcStats.gcTime += entry.duration;
        gcStats.lastGcDuration = entry.duration;
        gcStats.lastCollection = {
          type: entry.kind, // 'minor' or 'major'
          duration: entry.duration,
          timestamp: Date.now()
        };
        
        // Log major GC events
        if (entry.kind === 'major') {
          console.log(`[GC] Major collection: ${Math.round(entry.duration)}ms`);
        }
      }
    });
  });
  
  // Subscribe to GC events
  obs.observe({ entryTypes: ['gc'], buffered: false });
}

// Cluster setup for multiple workers
if (cluster.isPrimary) {  // Using isPrimary instead of isMaster (modern API)
  const workerCount = 2; // Force 2 workers even on t2.micro
  console.log(`Primary process running on ${process.pid}`);
  
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
    const memoryUsage = process.memoryUsage();
    
    res.status(200).json({
      status: 'OK',
      pid: process.pid,
      activeWorkers: activeWorkers.size,
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
        external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB'
      },
      gc: gcStats
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
          const endTime = Date.now() + seconds * 1000;
          while (Date.now() < endTime) {
            if (Date.now() > endTime + 50) {  // Ensure it doesn't exceed expected time
              break;
            }
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
  
  // Add this new endpoint for memory stress testing with improved GC tracking
  app.get('/api/memory/:mb', async (req, res) => {
    const targetMB = parseInt(req.params.mb) || 100;
    const chunkSizeMB = 10; // Allocate memory in 10MB chunks
    const memoryChunks = [];
    
    try {
      // Get baseline memory measurements
      const baselineMemory = process.memoryUsage();
      const startTime = performance.now();
      
      // Calculate chunks needed
      const chunks = Math.floor(targetMB / chunkSizeMB);
      
      // Gradually allocate memory
      for (let i = 0; i < chunks; i++) {
        const chunk = Buffer.alloc(chunkSizeMB * 1024 * 1024); // Allocate in MB
        // Fill with random data to prevent memory optimization
        chunk.fill(Math.random().toString());
        memoryChunks.push(chunk);
        
        // Brief pause between allocations
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Get current memory usage
      const memoryUsage = process.memoryUsage();
      const allocationTime = performance.now() - startTime;
      
      res.json({
        message: 'Memory allocation completed',
        requested_mb: targetMB,
        allocation_time_ms: Math.round(allocationTime),
        memory: {
          heap_used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          rss_mb: Math.round(memoryUsage.rss / 1024 / 1024),
          external_mb: Math.round(memoryUsage.external / 1024 / 1024)
        },
        increase: {
          heap_used_mb: Math.round((memoryUsage.heapUsed - baselineMemory.heapUsed) / 1024 / 1024),
          rss_mb: Math.round((memoryUsage.rss - baselineMemory.rss) / 1024 / 1024)
        },
        instance_id: process.env.HOSTNAME || 'local',
        pid: process.pid
      });

      // Release memory after 5 seconds
      setTimeout(() => {
        console.log(`[${process.pid}] Releasing ${targetMB}MB of allocated memory`);
        memoryChunks.length = 0;
        
        // Trigger garbage collection if available
        if (global.gc) {
          console.log(`[${process.pid}] Triggering manual garbage collection`);
          const beforeGc = process.memoryUsage();
          
          // Record GC time
          const gcStart = performance.now();
          global.gc();
          const gcDuration = performance.now() - gcStart;
          
          // Measure memory after GC
          setTimeout(() => {
            const afterGc = process.memoryUsage();
            console.log(`[${process.pid}] GC completed in ${Math.round(gcDuration)}ms, freed approximately ${
              Math.round((beforeGc.heapUsed - afterGc.heapUsed) / 1024 / 1024)
            }MB heap and ${
              Math.round((beforeGc.rss - afterGc.rss) / 1024 / 1024)
            }MB RSS`);
          }, 100);
        }
      }, 5000);

    } catch (error) {
      res.status(500).json({ 
        error: 'Memory allocation failed',
        details: error.message
      });
    }
  });
  
  // New endpoint to manually trigger GC
  app.post('/api/gc', (req, res) => {
    if (!global.gc) {
      return res.status(400).json({
        error: 'Garbage collection not available',
        message: 'Node was not started with --expose-gc flag'
      });
    }
    
    try {
      const beforeGc = process.memoryUsage();
      const startTime = performance.now();
      
      // Trigger garbage collection
      global.gc();
      
      const gcDuration = performance.now() - startTime;
      
      // Wait a moment for GC to complete fully
      setTimeout(() => {
        const afterGc = process.memoryUsage();
        
        res.json({
          message: 'Manual garbage collection completed',
          duration_ms: Math.round(gcDuration),
          before: {
            heap_used_mb: Math.round(beforeGc.heapUsed / 1024 / 1024),
            rss_mb: Math.round(beforeGc.rss / 1024 / 1024)
          },
          after: {
            heap_used_mb: Math.round(afterGc.heapUsed / 1024 / 1024),
            rss_mb: Math.round(afterGc.rss / 1024 / 1024)
          },
          freed: {
            heap_mb: Math.round((beforeGc.heapUsed - afterGc.heapUsed) / 1024 / 1024),
            rss_mb: Math.round((beforeGc.rss - afterGc.rss) / 1024 / 1024)
          }
        });
      }, 100);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to trigger garbage collection',
        details: error.message
      });
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
    console.log(`GC monitoring: ${global.gc ? 'enabled' : 'disabled'}`);
  });
}