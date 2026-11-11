// Lesson 2, the order line: levels, goals, and the concept each level teaches.
// Kept as data so the game and the tests read the same definitions.

export const COST = { barista: 18, rail: 2 };

export const designCost = d => d.baristas * COST.barista + (d.rail ? COST.rail : 0);

export const LEVELS = [
  {
    id: '2.1', name: 'Nobody walks out', budget: 40,
    brief: 'Fifty commuters will walk in over the next ten minutes. Right now the cashier only takes an order if a barista can start it on the spot. Anyone else walks out. Design a shop where nobody has to leave.',
    start: { baristas: 2, rail: false, capacity: Infinity }, capacityUnlocked: false,
    goals: [{ label: 'Serve all 50 customers', got: s => `${s.served} served`, ok: s => s.rejected === 0 }],
    concept: {
      term: 'Queue',
      body: 'A queue lets a system accept work now and do it later. Without one, a request that arrives while every worker is busy has to be rejected, even though the workers would be free a minute later.',
      real: 'The register is an <strong>API server</strong>. It answers <code>202 Accepted</code> and puts the order in a queue such as Redis Streams, Amazon SQS or Kafka. Workers take jobs from the queue when they are free.',
    },
  },
  {
    id: '2.2', name: 'Too long a wait', budget: 60,
    brief: 'Everyone got a drink, but some people waited close to an hour. Your manager wants every drink out within 40 minutes of walking in, and gave you a bigger budget for today.',
    start: { baristas: 2, rail: true, capacity: Infinity }, capacityUnlocked: false,
    goals: [
      { label: 'Serve all 50 customers', got: s => `${s.served} served`, ok: s => s.rejected === 0 },
      { label: 'Nobody waits more than 40 minutes', got: s => `longest ${s.longestWaitMin.toFixed(1)} min`, ok: s => s.longestWaitMin <= 40 },
    ],
    concept: {
      term: 'Throughput',
      body: 'A queue holds work, but it does not do the work any faster. How fast the line moves depends on throughput: how many jobs your workers finish per minute. Your wait is roughly the number of jobs ahead of you divided by the throughput.',
      real: 'Two baristas making 2½-minute drinks finish about 0.8 drinks a minute. Three finish about 1.2. Adding more workers to share the load is called <strong>horizontal scaling</strong>, and it comes back in lesson 5.',
    },
  },
  {
    id: '2.3', name: 'Know when to say no', budget: 60,
    brief: 'Waiting 30 minutes for a latte is worse than going somewhere else. Your manager says nobody should wait more than 20 minutes. When the rail is full, the cashier should apologize and turn people away. Decide how many tickets the rail can hold.',
    start: { baristas: 2, rail: true, capacity: 30 }, capacityUnlocked: true,
    goals: [
      { label: 'Nobody waits more than 20 minutes', got: s => `longest ${s.longestWaitMin.toFixed(1)} min`, ok: s => s.longestWaitMin <= 20 },
      { label: 'Turn away 25 customers or fewer', got: s => `${s.rejected} turned away`, ok: s => s.rejected <= 25 },
    ],
    concept: {
      term: 'Bounded queue',
      body: 'Real queues have a limit. When the queue is full, the system rejects new work right away instead of making people wait forever. Picking the limit is a trade-off: too small and you turn away too many people, too big and waits get unacceptable.',
      real: 'A full queue answers <code>503 Service Unavailable</code> or <code>429 Too Many Requests</code>, so the client knows to try later. Rejecting work on purpose to protect everyone else is the start of <strong>backpressure</strong>, which is lesson 7.',
    },
  },
];

// Parts from later lessons, shown as locked cards so players see what's coming.
export const LOCKED = [
  { name: 'Mobile ordering', sys: 'Priority queue', lesson: 'Lesson 3' },
  { name: 'Batch the milk', sys: 'Batching', lesson: 'Lesson 4' },
  { name: 'Second register', sys: 'Load balancer', lesson: 'Later' },
  { name: 'Pastry case', sys: 'Cache', lesson: 'Lesson 8' },
];

// Drinks per minute: baristas divided by the average drink time (about 2.55 shop minutes).
const throughput = d => (d.baristas / 2.55).toFixed(1);
const mins = s => s.longestWaitMin.toFixed(1);

// What happened, in system design terms. s.ok is whether every goal was met.
LEVELS[0].explain = (d, s) => {
  if (!d.rail) return `Every request that arrived while all ${d.baristas} barista${d.baristas > 1 ? 's were' : ' was'} busy got a <strong>503</strong>. The workers weren't slow: they were busy ${Math.round(s.utilization * 100)}% of the time. The problem is that a request had nowhere to wait. Adding baristas costs $${COST.barista} each and only saves a few more people. What could hold an order until someone is free?`;
  return `The rail held every order until a barista was free, so nobody was turned away. Look at the longest wait though: <strong>${mins(s)} minutes</strong>. The queue saved everyone, but it didn't make anyone faster.`;
};
LEVELS[1].explain = (d, s) => {
  if (!d.rail) return `Without the rail, ${s.rejected} customers were turned away. Keep the queue, and think about what makes it drain faster.`;
  if (!s.ok) return `Everyone was served, but the longest wait was <strong>${mins(s)} minutes</strong>. ${d.baristas} baristas finish about ${throughput(d)} drinks a minute, and ${s.peakQueue} tickets piled up. The queue can only drain as fast as your workers finish jobs.`;
  return `${d.baristas} baristas finish about ${throughput(d)} drinks a minute, so the rail drained in time and the longest wait was <strong>${mins(s)} minutes</strong>. A queue holds work. Workers do it.`;
};
LEVELS[2].explain = (d, s) => {
  if (!d.rail) return `Without the rail, ${s.rejected} customers were turned away. You need a queue, just not an endless one.`;
  const long = s.longestWaitMin > 20, many = s.rejected > 25;
  if (long && many) return 'Both goals missed. Try more baristas, then tune the rail size.';
  if (long) return `Your rail let ${s.peakQueue} tickets pile up. At about ${throughput(d)} drinks a minute, the last ticket waited <strong>${mins(s)} minutes</strong>. A smaller rail turns people away sooner instead of making them wait. More baristas let you keep a bigger rail.`;
  if (many) return `The rail filled up and turned away <strong>${s.rejected}</strong> customers. A bigger rail, or more baristas to drain it faster, would keep more of them.`;
  return `A rail of ${d.capacity} with ${d.baristas} barista${d.baristas > 1 ? 's' : ''} kept every wait under 20 minutes and turned away ${s.rejected}. That's the trade-off a queue limit makes: a quick "sorry, we're full" for some people, so nobody waits forever.`;
};

/** Did a design pass a level? Budget is checked here too, since the game blocks over-budget runs. */
export function evaluate(level, design, summary) {
  const goals = level.goals.map(g => ({ label: g.label, ok: g.ok(summary) }));
  const withinBudget = designCost(design) <= level.budget;
  return { passed: withinBudget && goals.every(g => g.ok), withinBudget, goals };
}
