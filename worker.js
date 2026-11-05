// Il sito online gira come Worker con i file statici (è a questo Worker che è collegato crochetbyalessia.com).
// Qui adatto il motore dell'admin (scritto come Pages Function in functions/[[path]].js) al Worker:
// "next" diventa la richiesta ai file statici della cartella sito/.
import { onRequest } from "./functions/[[path]].js";

export default {
  fetch(request, env, ctx) {
    return onRequest({ request, env, waitUntil: (p) => ctx.waitUntil(p), next: (r) => env.ASSETS.fetch(r || request) });
  }
};
