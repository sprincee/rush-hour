// One rush on the real cluster: the same customers, arriving at the same moments,
// as the game. scripts/rush.ps1 mounts this file with arrivals.js (from
// web/src/arrivals.mjs), config.json (from shop/config.json), and rush-id.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { buildSchedule } from './arrivals.js';

// The rush comes only from files in the repo, so nothing outside it can make it bigger.
const config = JSON.parse(open('./config.json'));
const RUSH_ID = open('./rush-id').trim();
const SCHEDULE = buildSchedule(config);
const TIME_SCALE = config.timeScale; // Shop seconds per real second.

const REGISTER = 'http://register.rush-hour.svc.cluster.local';
const POLL_SECONDS = 2; // Each customer asks "is my drink ready?" this often.
const GIVE_UP_SECONDS = 240;

const drinkWait = new Trend('drink_wait_seconds');
const ordersReady = new Counter('orders_ready');
const ordersNotReady = new Counter('orders_not_ready');

export const options = {
  scenarios: {
    rush: {
      executor: 'per-vu-iterations', // One virtual customer places one order.
      vus: SCHEDULE.length,
      iterations: 1,
      maxDuration: '5m',
    },
  },
  // Failing any of these makes k6 exit with an error, which fails the Job.
  thresholds: {
    orders_ready: [`count==${SCHEDULE.length}`],
    checks: ['rate==1'],
  },
};

export default function () {
  const order = SCHEDULE[__VU - 1];
  sleep(order.at / TIME_SCALE);

  const placed = http.post(
    `${REGISTER}/orders`,
    JSON.stringify({ item: order.item, customer: `rush-${RUSH_ID}-${order.id}` }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '10s' },
  );
  if (!check(placed, { 'order accepted': (r) => r.status === 202 })) {
    ordersNotReady.add(1);
    return;
  }

  const orderId = placed.json('order_id');
  const startedAt = Date.now();
  while ((Date.now() - startedAt) / 1000 < GIVE_UP_SECONDS) {
    sleep(POLL_SECONDS);
    const ticket = http.get(`${REGISTER}/orders/${orderId}`, { timeout: '10s' });
    if (ticket.status === 200 && ticket.json('status') === 'ready') {
      drinkWait.add((Date.now() - startedAt) / 1000);
      ordersReady.add(1);
      return;
    }
  }
  ordersNotReady.add(1);
}
