import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 1 },    // Warm up
    { duration: '2m', target: 5 },    // Gradual ramp-up
    { duration: '5m', target: 10 },   // Sustained load
    { duration: '2m', target: 2 },    // Scale down
    { duration: '10s', target: 0 },   // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests should be below 3s
    http_req_failed: ['rate<0.1'],     // Less than 10% failure rate
  }
};

export default function() {
  const url = "http://15.206.195.19";  // Your ECS service URL

  // Memory test - gradually increase memory usage
  const memoryMB = Math.floor(Math.random() * 100) + 50; // Request between 50-150MB
  const memoryResp = http.get(`${url}/api/memory/${memoryMB}`);
  check(memoryResp, {
    'memory status was 200': (r) => r.status === 200,
    'memory allocation successful': (r) => {
      const body = JSON.parse(r.body);
      return body.heap_used_mb > 0;
    }
  });

  // Keep the existing delay test but reduce frequency
  if (Math.random() < 0.3) { // Only run 30% of the time
    const delay = Math.floor(Math.random() * 500) + 100;
    const delayResp = http.get(`${url}/api/delay/${delay}`);
    check(delayResp, {
      'delay status was 200': (r) => r.status === 200,
    });
  }

  // Keep the CPU test but reduce frequency
  if (Math.random() < 0.3) { // Only run 30% of the time
    const cpuLoad = Math.floor(Math.random() * 2) + 1;
    const cpuResp = http.get(`${url}/api/cpu/${cpuLoad}`);
    check(cpuResp, {
      'cpu status was 200': (r) => r.status === 200,
    });
  }

  sleep(1);
}
