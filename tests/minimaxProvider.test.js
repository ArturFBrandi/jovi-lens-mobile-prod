import test from 'node:test';
import assert from 'node:assert/strict';
import { complete } from '../api/_lib/ai/providers/minimax.js';
import { withEnv } from './helpers/http.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ENV = {
  MINIMAX_API_KEY: 'server-minimax-key',
  MINIMAX_BASE_URL: undefined,
  MINIMAX_CHAT_MODEL: undefined,
  MINIMAX_VISION_MODEL: undefined,
};

function reply(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], base_resp: { status_code: 0 } }), { status: 200 });
}

// Answers each call with the next content and records the request bodies.
function sequence(...contents) {
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return reply(contents[bodies.length - 1]);
  };
  return bodies;
}

function minimaxTest(name, fn) {
  test(name, () => withEnv(ENV, async () => {
    try {
      await fn();
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  }));
}

const IMAGE_MESSAGES = [{ role: 'user', content: [{ type: 'text', text: 'Analise a imagem.' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } }] }];

minimaxTest('Text-01 by default; MINIMAX_VISION_MODEL picks the model for image calls', async () => {
  const bodies = sequence('{"ok":true}', '{"ok":true}', '{"ok":true}');
  assert.equal((await complete({ messages: IMAGE_MESSAGES })).model, 'MiniMax-Text-01');
  assert.equal((await complete({ messages: [{ role: 'user', content: 'Explique.' }] })).model, 'MiniMax-Text-01');
  await withEnv({ MINIMAX_VISION_MODEL: 'MiniMax-M3' }, () => complete({ messages: IMAGE_MESSAGES }));
  assert.deepEqual(bodies.map((body) => body.model), ['MiniMax-Text-01', 'MiniMax-Text-01', 'MiniMax-M3']);
});

minimaxTest('a clean answer is returned as is, with one call', async () => {
  const bodies = sequence('{"summary":"Células vistas ao microscópio."}');
  const result = await complete({ messages: IMAGE_MESSAGES });
  assert.equal(result.text, '{"summary":"Células vistas ao microscópio."}');
  assert.equal(bodies.length, 1);
});

minimaxTest('a Chinese slip is repaired by the text model, keeping the JSON', async () => {
  const bodies = sequence('{"summary":"Uma fábrica de九江 velas."}', '{"summary":"Uma fábrica de velas."}');
  const result = await complete({ messages: IMAGE_MESSAGES });
  assert.equal(result.text, '{"summary":"Uma fábrica de velas."}');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].model, 'MiniMax-Text-01');
  assert.match(bodies[1].messages[0].content, /fábrica de九江 velas/);
});

minimaxTest('an unusable repair keeps the original answer', async () => {
  sequence('{"summary":"Uma fábrica de九江 velas."}', 'Aqui está: não é JSON');
  assert.equal((await complete({ messages: IMAGE_MESSAGES })).text, '{"summary":"Uma fábrica de九江 velas."}');
  sequence('{"summary":"Uma fábrica de九江 velas."}', '{"summary":"Ainda 九江."}');
  assert.equal((await complete({ messages: IMAGE_MESSAGES })).text, '{"summary":"Uma fábrica de九江 velas."}');
});

minimaxTest('CJK that was in the request is content, not a slip', async () => {
  const bodies = sequence('{"reply":"九江 é uma cidade da China."}');
  await complete({ messages: [{ role: 'user', content: 'O que significa 九江?' }] });
  assert.equal(bodies.length, 1);
});
