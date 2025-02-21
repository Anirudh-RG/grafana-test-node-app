// k6-script.js
import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Ramp up to 10 users
    { duration: '3m', target: 100 },   // Ramp up to 50 users
    { duration: '5m', target: 1000 },  // Ramp up to 100 users
    { duration: '3m', target: 0 },    // Ramp down to 0 users
  ],
};

export default function() {
  // Mix of requests to trigger different load patterns
  const delay = Math.floor(Math.random() * 500) + 100;
  const cpuLoad = Math.floor(Math.random() * 2) + 1;
  
  // url = http://dev-cluster-LB-api-Library-110851598.ap-south-1.elb.amazonaws.com

  const delayResp = http.get(`http://dev-cluster-LB-api-Library-110851598.ap-south-1.elb.amazonaws.com/api/delay/${delay}`);
  check(delayResp, { 'delay status was 200': (r) => r.status === 200 });
  
  const cpuResp = http.get(`http://dev-cluster-LB-api-Library-110851598.ap-south-1.elb.amazonaws.com/api/cpu/${cpuLoad}`);
  check(cpuResp, { 'cpu status was 200': (r) => r.status === 200 });
  
  sleep(1);
}