// Tap-to-define: software words that show up in the game, each in one or two plain
// sentences, with the shop version. The game links the first mention of each term in a
// ticket, freeze-frame card, or stats label (web/src/game/define.mjs).
//
// match: a regular expression source, matched case-insensitively unless `exact` is set.
// Longer phrases come first, so "API server" wins over "API".

export const TERMS = [
  { key: 'slo', match: '[Ss]ervice level objectives?|SLOs?', exact: true, title: 'SLO',
    def: 'Service level objective: a target a system promises to hit, like "nobody waits more than 20 minutes". Teams watch them on dashboards.' },
  { key: '202', match: '202(?: Accepted)?', title: '202 Accepted',
    def: 'The server\'s way of saying "got it, it\'s being worked on". The job isn\'t done yet. In the shop: your ticket.' },
  { key: '200', match: '200 OK', title: '200 OK',
    def: 'The request finished successfully. In the shop: "Order up!" and your drink on the counter.' },
  { key: '503', match: '503(?: Service Unavailable)?', title: '503 Service Unavailable',
    def: 'The server is saying "I can\'t take this right now, try later." In the shop: the customer is turned away.' },
  { key: '429', match: '429(?: Too Many Requests)?', title: '429 Too Many Requests',
    def: 'Like a 503, but it means "you, specifically, are sending too much". Lesson 6 is about it.' },
  { key: 'api', match: 'API servers?|APIs?', exact: true, title: 'API server',
    def: 'The front door of a service, where requests come in and answers go out. In the shop: the register.' },
  { key: 'worker', match: 'workers?', title: 'Worker',
    def: 'A program that takes jobs off a queue and does them, one at a time. In the shop: a barista.' },
  { key: 'latency', match: 'latency', title: 'Latency',
    def: 'How long something takes, from asking to getting it. In the shop: from walking in until your drink is ready.' },
  { key: 'response', match: 'response time', title: 'Response time',
    def: 'How long until the system answers, even if the work isn\'t finished yet. In the shop: how fast you get a ticket.' },
  { key: 'throughput', match: 'throughput', title: 'Throughput',
    def: 'How much work gets finished per minute. In the shop: drinks handed out per minute.' },
  { key: 'utilization', match: 'utili[sz]ation', title: 'Utilization',
    def: 'The share of time workers are busy. Near 100% means nobody ever rests, so any extra work has to wait.' },
  { key: 'depth', match: 'queue depth|peak queues?', title: 'Queue depth',
    def: 'How many jobs are waiting in the queue right now. In the shop: tickets on the rail.' },
  { key: 'redis', match: 'Redis Streams?|Redis', title: 'Redis Streams',
    def: 'Redis is a fast database that lives in memory. Its Streams feature is a queue, and the real cluster behind this game uses it as the ticket rail.' },
  { key: 'sqs', match: 'Amazon SQS|SQS', title: 'Amazon SQS',
    def: 'Amazon\'s queue service: you put messages in, and workers take them out. You pay per request.' },
  { key: 'kafka', match: 'Kafka', title: 'Kafka',
    def: 'A popular system for streaming huge numbers of messages between services, kept in order.' },
  { key: 'scaling', match: 'horizontal scaling', title: 'Horizontal scaling',
    def: 'Handling more load by adding more workers, instead of making one worker faster. Lesson 5 does it automatically.' },
  { key: 'backpressure', match: 'backpressure', title: 'Backpressure',
    def: 'Pushing back on new work when the system is full, so it doesn\'t fall over. Lesson 7 is about it.' },
  { key: 'policy', match: 'scheduling policy', title: 'Scheduling policy',
    def: 'The rule that decides which waiting job a worker takes next. In the shop: which ticket a barista grabs.' },
  { key: 'k8s', match: 'Kubernetes', title: 'Kubernetes',
    def: 'Software that runs programs in containers across machines, and restarts or adds copies as needed. This game is checked against a real Kubernetes cluster.' },
  { key: 'linger', match: 'linger\\.ms', title: 'linger.ms',
    def: 'A Kafka setting: how long to wait for more messages before sending a batch. The batch window, in milliseconds.' },
];

const byKey = Object.fromEntries(TERMS.map(t => [t.key, t]));
export const term = key => byKey[key];

const PATTERN = new RegExp(`\\b(?:${TERMS.map(t => `(${t.match})`).join('|')})\\b`, 'gi');
const EXACT = TERMS.map(t => (t.exact ? new RegExp(`^(?:${t.match})$`) : null));

/**
 * Split text into plain pieces and terms to link. Each term links once: keys already in
 * `seen` stay plain, and new ones are added to it.
 * @returns [{ text } | { text, key }]
 */
export function splitTerms(text, seen = new Set()) {
  const out = [];
  let last = 0;
  PATTERN.lastIndex = 0;
  for (let m; (m = PATTERN.exec(text));) {
    const i = m.slice(1).findIndex(g => g !== undefined);
    const t = TERMS[i];
    if (seen.has(t.key) || (EXACT[i] && !EXACT[i].test(m[0]))) continue;
    seen.add(t.key);
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], key: t.key });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
