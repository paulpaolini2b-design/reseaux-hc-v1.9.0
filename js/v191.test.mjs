/* v191.test.mjs — essais v1.9.1 : plan de situation face à un HTTP 400 du service (H-380).
 * Lancer : node js/v191.test.mjs   (non précaché par le service worker, comme les autres essais)
 * fetch, createImageBitmap, navigator et canvas sont simulés. */
import assert from 'node:assert/strict';

const zoneFactice = { clientWidth: 1200, clientHeight: 800, style: {}, appendChild() {}, querySelector() { return null; } };
const contexte = { fillRect() {}, drawImage() {}, measureText: () => ({ width: 100 }), fillText() {}, set fillStyle(v) {}, set font(v) {}, set textBaseline(v) {} };
globalThis.document = {
  getElementById: (id) => (id === 'zone-plan' ? zoneFactice : null),
  createElement: () => ({ getContext: () => contexte, toBlob: (cb) => cb({ type: 'image/jpeg' }), style: {} }),
  addEventListener() {}
};
globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false }), addEventListener() {} };
globalThis.createImageBitmap = async () => ({ close() {} });

const S = await import('./situation.js');

let appels = [];
const OK = () => ({ status: 200, ok: true, blob: async () => ({ type: 'image/png' }) });
const R400 = (txt = '<ExceptionReport><Exception exceptionCode="TileOutOfRange"><ExceptionText>Tile out of range</ExceptionText></Exception></ExceptionReport>') =>
  ({ status: 400, ok: false, text: async () => txt });
let reponse = OK;
globalThis.fetch = async (url, opt) => { appels.push(url); return reponse(url, opt); };

const niveauDe = (u) => Number(/TILEMATRIX=(\d+)/.exec(u)[1]);
const essais = [];
const essai = (nom, fn) => essais.push([nom, fn]);
const dims = { largeurPx: 800, hauteurPx: 600 };

essai('detailService : balises retirées, 160 caractères au plus', () => {
  assert.equal(S.detailService('<a><b>Tile out of range</b></a>'), 'Tile out of range');
  assert.ok(S.detailService('x'.repeat(500)).length <= 161);
  assert.equal(S.detailService(null), '');
});

essai('reperesTuile : niveau, ligne, colonne', () => {
  assert.equal(S.reperesTuile(S.urlTuile(18, 137951, 96624)), 'niveau 18, ligne 96624, colonne 137951');
});

essai('HTTP 400 sur toutes les tuiles à tous les niveaux : message précis, sans « réessayer plus tard »', async () => {
  appels = []; reponse = () => R400();
  await assert.rejects(S.genererCarteSituation('42.6971, 9.4501', 18, dims), (e) =>
    /requête refusée par le service IGN \(HTTP 400, niveau \d+, ligne \d+, colonne \d+\)/.test(e.message) && /Tile out of range/.test(e.message) && !/plus tard/.test(e.message));
  const niveaux = [...new Set(appels.map(niveauDe))];
  assert.deepEqual(niveaux, [18, 17, 16]);   // deux reculs au plus
});

essai('400 au niveau demandé, 200 un niveau plus bas : carte obtenue, emprise au sol conservée', async () => {
  appels = []; reponse = (u) => (niveauDe(u) === 18 ? R400() : OK());
  const c = await S.genererCarteSituation('42.6971, 9.4501', 18, dims);
  assert.equal(c.zoom, 17);
  assert.equal(c.zoom_demande, 18);
  assert.equal(c.largeurPx, 400);
  assert.equal(c.hauteurPx, 300);
  const solDemande = 800 * S.metresParPixel(42.6971, 18), solObtenu = c.largeurPx * S.metresParPixel(42.6971, c.zoom);
  assert.ok(Math.abs(solDemande - solObtenu) < 1e-6);
});

essai('400 sur une partie des tuiles seulement : carte composée, tuiles refusées laissées en blanc, aucun recul', async () => {
  appels = []; let i = 0; reponse = () => (i++ % 3 === 0 ? R400() : OK());
  const c = await S.genererCarteSituation('42.6971, 9.4501', 18, dims);
  assert.equal(c.zoom, 18);
  assert.ok(c.tuiles_absentes > 0);
  assert.deepEqual([...new Set(appels.map(niveauDe))], [18]);
});

essai('503 : message inchangé (« réessayer plus tard »), pas de recul', async () => {
  appels = []; reponse = () => ({ status: 503, ok: false });
  await assert.rejects(S.genererCarteSituation('42.6971, 9.4501', 15), (e) => /service IGN en erreur \(HTTP 503\) — réessayer plus tard/.test(e.message));
  assert.deepEqual([...new Set(appels.map(niveauDe))], [15]);
});

essai('403 : requête refusée, pas de « réessayer plus tard »', async () => {
  reponse = () => ({ status: 403, ok: false, text: async () => 'Forbidden' });
  await assert.rejects(S.genererCarteSituation('42.6971, 9.4501', 15), (e) => /requête refusée par le service IGN \(HTTP 403/.test(e.message) && !/plus tard/.test(e.message));
});

essai('404 partout : message « hors couverture » inchangé, pas de recul', async () => {
  appels = []; reponse = () => ({ status: 404, ok: false });
  await assert.rejects(S.genererCarteSituation('42.6971, 9.4501', 15), /hors couverture/);
  assert.deepEqual([...new Set(appels.map(niveauDe))], [15]);
});

let echecs = 0;
for (const [nom, fn] of essais) {
  try { await fn(); console.log('ok   ', nom); } catch (e) { echecs++; console.log('ÉCHEC', nom, '\n     ', e.message); }
}
console.log(echecs ? echecs + ' échec(s)' : 'v191 : ' + essais.length + ' essais passés');
process.exit(echecs ? 1 : 0);
