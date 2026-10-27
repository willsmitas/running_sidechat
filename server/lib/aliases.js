// Sidechat-style anonymous identities: inside a thread every participant gets
// a stable animal icon, and the original poster is labelled OP. Identities are
// per-thread, so the same person is a different animal in every post.

const ANIMALS = [
  ['🦊', 'Fox'], ['🐺', 'Wolf'], ['🦌', 'Deer'], ['🐇', 'Hare'], ['🐆', 'Cheetah'], ['🦅', 'Eagle'],
  ['🐎', 'Horse'], ['🦒', 'Giraffe'], ['🐻', 'Bear'], ['🦁', 'Lion'], ['🐯', 'Tiger'], ['🐼', 'Panda'],
  ['🐨', 'Koala'], ['🐸', 'Frog'], ['🐙', 'Octopus'], ['🦉', 'Owl'], ['🐧', 'Penguin'], ['🦩', 'Flamingo'],
  ['🦘', 'Kangaroo'], ['🦓', 'Zebra'], ['🐢', 'Turtle'], ['🦬', 'Bison'], ['🐐', 'Goat'], ['🦙', 'Llama'],
  ['🦔', 'Hedgehog'], ['🦦', 'Otter'], ['🦡', 'Badger'], ['🐿️', 'Chipmunk'], ['🦫', 'Beaver'], ['🐝', 'Bee'],
  ['🦋', 'Butterfly'], ['🐞', 'Ladybug'], ['🦈', 'Shark'], ['🐬', 'Dolphin'], ['🐳', 'Whale'], ['🦭', 'Seal'],
  ['🦜', 'Parrot'], ['🦢', 'Swan'], ['🐊', 'Gator'], ['🦖', 'T-Rex'], ['🐉', 'Dragon'], ['🦄', 'Unicorn'],
  ['🐌', 'Snail'], ['🐓', 'Rooster'], ['🦃', 'Turkey'], ['🐗', 'Boar'], ['🦏', 'Rhino'], ['🐘', 'Elephant'],
];

const COLORS = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#2e86ab', '#a23b72', '#f18f01', '#6a4c93', '#c73e1d', '#3bb273', '#ef476f', '#118ab2'];

function seeded(postId) {
  // Deterministic shuffle offset per post so the same idx looks different
  // across threads, without storing anything extra.
  let x = (postId * 2654435761) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function aliasFor(postId, idx) {
  const s = seeded(postId);
  const animal = ANIMALS[(s + idx * 7) % ANIMALS.length];
  const color = COLORS[(Math.floor(s / 7) + idx * 5) % COLORS.length];
  const cycle = Math.floor(idx / ANIMALS.length);
  return {
    idx,
    emoji: animal[0],
    name: idx === 0 ? 'OP' : cycle ? `${animal[1]} ${cycle + 1}` : animal[1],
    color,
    isOp: idx === 0,
  };
}
