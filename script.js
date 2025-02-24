import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 40 },
    { duration: '3m', target: 200 },
    { duration: '2m', target: 300 },
    { duration: '4m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests should be below 3s
    http_req_failed: ['rate<0.1'],     // Less than 10% failure rate
  }
};

export default function() {
  const delay = Math.floor(Math.random() * 500) + 100;
  const cpuLoad = Math.floor(Math.random() * 2) + 1;

  const url = "http://lb-non-scaler-grafana-api-1627796980.ap-south-1.elb.amazonaws.com";  // FIXED URL

  const delayResp = http.get(`${url}/api/delay/${delay}`);
  // console.log(`Delay API Response: Status=${delayResp.status}, Body=${delayResp.body}`);
  check(delayResp, {
    'delay status was 200': (r) => r.status === 200,
    'delay time within bounds': (r) => {
      const body = JSON.parse(r.body);
      return body.actual_delay <= delay * 1.1; // Allow 10% margin
    }
  });

  const cpuResp = http.get(`${url}/api/cpu/${cpuLoad}`);
  // console.log(`CPU API Response: Status=${cpuResp.status}, Body=${cpuResp.body}`);
  check(cpuResp, { 
    'cpu status was 200': (r) => r.status === 200,
  });
  

  sleep(1);
}
