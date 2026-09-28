// Every route handler and middleware in this app used to be fully
// synchronous (node:sqlite's DatabaseSync API never returned a Promise).
// Now that db.js is Postgres-backed, every db call is async — but Express 4
// does NOT catch a Promise a handler returns; a rejected one becomes an
// unhandled rejection (which, by Node's default, crashes the whole worker
// process) instead of reaching server.js's central error-handling
// middleware and sending a real 500 response.
//
// Rather than hand-wrap all ~115 route registrations across routes/*.js
// with a try/catch or a helper, this patches express.Router() itself, once,
// here — every handler passed to .get/.post/.put/.patch/.delete/.use on any
// router created anywhere in the app (present or future) is transparently
// wrapped: a thrown error or a rejected Promise is forwarded to next(err),
// exactly like a synchronous throw already was before this app's database
// calls became async. Import this once, before any route file is
// require()'d (see server.js) — requiring express elsewhere afterwards
// returns the same patched module (Node's require cache), so route files
// themselves need no changes at all.
const express = require('express');

function wrapAsRegularHandler(fn) {
  return function wrappedHandler(req, res, next) {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

function wrapAsErrorHandler(fn) {
  // Express detects "this .use()'d function is an error handler" purely by
  // its declared arity (exactly 4 params) — the wrapper must keep that
  // shape, unlike the 3-arg case above, or a real error-handling
  // middleware would silently stop being treated as one.
  return function wrappedErrorHandler(err, req, res, next) {
    try {
      const result = fn(err, req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (e) {
      next(e);
    }
  };
}

function asyncHandler(fn) {
  if (typeof fn !== 'function') return fn;
  return fn.length >= 4 ? wrapAsErrorHandler(fn) : wrapAsRegularHandler(fn);
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];
let patched = false;
function patchExpressRouter() {
  if (patched) return;
  patched = true;
  const OriginalRouter = express.Router;
  express.Router = function patchedRouterFactory(...routerArgs) {
    const router = OriginalRouter(...routerArgs);
    HTTP_METHODS.forEach((method) => {
      const original = router[method].bind(router);
      router[method] = function patchedMethod(...handlers) {
        return original(...handlers.map((h) => asyncHandler(h)));
      };
    });
    return router;
  };
  // Preserve static helpers hung off the original factory (e.g. express.Router.something), if any.
  Object.assign(express.Router, OriginalRouter);
}

patchExpressRouter();

module.exports = { asyncHandler };
