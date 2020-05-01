'use strict';

var bodyParser = require('body-parser')
let _ = require('lodash');
let assert = require('assert');
let logfmt = require('logfmt');
let express = require('express');
let urlUtil = require('url');
let StatsD = require('node-statsd');
let basicAuth = require('basic-auth');
let statsd = new StatsD(parseStatsdUrl(process.env.STATSD_URL));
let app = module.exports = express();
let allowedApps = loadAllowedAppsFromEnv();

if (process.env.DEBUG) {
  console.log(`Allowed apps: ${Object.keys(allowedApps)}`);
  statsd.send = wrap(statsd.send.bind(statsd), console.log.bind(null, 'Intercepted: statsd.send(%s):'));
}

app.use(bodyParser.text({
  'type': 'application/logplex-1',
  'limit': null
}));

app.use(function authenticate (req, res, next) {
  let auth = basicAuth(req) || {};
  let app = allowedApps[auth.name];
  if (app !== undefined && app.password === auth.pass) {
    req.defaultTags = app.tags;
    req.prefix = app.prefix;
    next();
  } else {
    res.status(401).send('Unauthorized');
    if (process.env.DEBUG) {
      console.log('Unauthorized access by %s', auth.name);
    }
  }
});

app.post('/', function (req, res) {
  try {
    if (req.body && 'string' === typeof req.body) {
      req.body.trim().split('\n').forEach(function (line) {
        processLine(logfmt.parse(line), req.prefix, req.defaultTags);
      });
    }
    res.status(200).send('OK');
  } catch(error) {
    console.log(error)
    res.status(500);
  }
});

let port = process.env.PORT || 3000;
app.listen(port, function () {
  console.log('Server listening on port ' + port);
});

function formatPath(url) {
  const urlNoUuids = url.replace(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})+/gi, '/:uuid')
  const urlNoUrlParams = urlNoUuids.replace(/(\?.*)/, '')
  return urlNoUrlParams.replace(/\/(\d+)+?/g, '/:id') // replace ids
}

/**
 * Matches a line against a rule and processes it
 * @param {object} line
 */
function processLine (line, prefix, defaultTags) {
  // Dyno metrics
  if (hasKeys(line, ['heroku', 'source', 'dyno'])) {
    if (process.env.DEBUG) {
      console.log('Processing dyno metrics');
    }
    let tags = tagsToArr({ dyno: line.source });
    tags = _.union(tags, defaultTags);
    let metrics = _.pick(line, (_, key) => key.startsWith('sample#'));
    _.forEach(metrics, function (value, key) {
      key = key.split('#')[1];
      key = key.replace(/_/g, '.');
      statsd.histogram(prefix + 'heroku.dyno.' + key, extractNumber(value), tags);
    });
  }

  // Router metrics
  else if (hasKeys(line, ['heroku', 'router', 'path', 'method', 'dyno', 'status', 'connect', 'service', 'at'])) {
    if (process.env.DEBUG) {
      console.log('Processing router metrics');
    }
    let tags = tagsToArr(_.pick(line, ['dyno', 'method', 'status', 'host', 'code', 'desc']));

    // Remove the ids from the path
    let pathObject = _.pick(line, ['path'])
    pathObject['path'] = formatPath(pathObject['path'])
    let pathTag = tagsToArr(pathObject)

    tags = _.union(tags, defaultTags, pathTag);
    statsd.histogram(prefix + 'heroku.router.request.connect', extractNumber(line.connect), tags);
    statsd.histogram(prefix + 'heroku.router.request.service', extractNumber(line.service), tags);
    if (line.at === 'error') {
      statsd.increment(prefix + 'heroku.router.error', 1, tags);
    }
  }

  // Postgres metrics
  else if (hasKeys(line, ['source', 'heroku-postgres'])) {
    if (process.env.DEBUG) {
      console.log('Processing postgres metrics');
    }
    let tags = tagsToArr({ source: line.source });
    tags = _.union(tags, defaultTags);
    let metrics = _.pick(line, (_, key) => key.startsWith('sample#'));
    _.forEach(metrics, function (value, key) {
      key = key.split('#')[1];
      statsd.histogram(prefix + 'heroku.postgres.' + key, extractNumber(value), tags);
      // TODO: Use statsd counters or gauges for some postgres metrics (db size, table count, ..)
    });
  }

  // Scaling event
  else if (line.api === true && line.Scale === true) {
    if (process.env.DEBUG) {
      console.log('Processing scaling metrics');
    }
    let tags = defaultTags;
    _.forEach(line, function (value, key) {
      if (value !== true && parseInt(value)) {
          statsd.gauge(prefix + 'heroku.dyno.' + key, parseInt(value), tags);
      }
    });
  }

  // Default
  else {
    if (process.env.DEBUG) {
      console.log('No match for line');
    }
  }

  return;
}

/**
 * Create properties obj for node-statsd from an statsd url
 * @param {string} [url]
 * @return {string|undefined}
 */
function parseStatsdUrl(url) {
  if (url !== undefined) {
    url = urlUtil.parse(url);
    return {
      host: url.hostname,
      port: url.port
    };
  }

  return undefined; // Explicit is better than implicit :)
}

/**
 * Transform an object to an array of statsd tags
 * @param {object} tags
 * @return {string[]}
 */
function tagsToArr (tags) {
  return _.transform(tags, (arr, value, key) => arr.push(key + ':' + value), []);
}

/**
 * Check if object contains list of keys
 */
function hasKeys (object, keys) {
  return _.every(keys, _.partial(_.has, object));
}

/**
 * Construct allowed apps object from the environment vars containing
 * names, passwords and default tags for apps that may use the drain
 */
function loadAllowedAppsFromEnv () {
  assert(process.env.ALLOWED_APPS, 'Environment variable ALLOWED_APPS required');
  let appNames = process.env.ALLOWED_APPS.split(',');
  let apps = {};

  appNames.map(function (name) {
    const upperUnderscoreName = name.replace(/-/g, '_').toUpperCase()

    // Password
    const passwordEnvName = `${upperUnderscoreName}_PASSWORD`;
    var password = process.env[passwordEnvName];
    assert(password, `Environment variable ${passwordEnvName} required`);

    // Tags
    var tags = process.env[`${upperUnderscoreName}_TAGS`];
    tags = tags === undefined ? [] : tags.split(',');

    // Prefix
    var prefix = process.env[`${upperUnderscoreName}_PREFIX`] || '';
    if (prefix && prefix.slice(-1) !== '.') {
      prefix += '.';
    }

    apps[name.replace(/_/g, '-')] = {
      password,
      tags,
      prefix
    }
  });

  return apps;
}

/**
 *
 */
function extractNumber (string) {
  if (typeof string === 'string') {
    var match = string.match(/[\d\.]+/);
    if (match !== null && match.length > 0) {
      return Number(match[0]);
    }
  }
  return undefined;
}

/**
 * Wrap a function with another function
 * @param {function} fn
 * @param {function} wrapper
 * @return {function}
 */
function wrap (fn, wrapper) {
  return function (...args) {
    wrapper(...args);
    fn.apply(null, args);
  };
}
