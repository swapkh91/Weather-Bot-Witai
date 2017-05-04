'use strict';

let Wit = null;
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
const uuid = require('uuid');
const {WIT_TOKEN, APPID} = require('./config');
const fetch = require('isomorphic-fetch');
const express = require('express');
const app = express();
let sessionId = null;
let interactive = null;

const _store = {};

function getContext(sessionId) {
  return _store[sessionId] || {};
};

function setContext(sessionId, ctx) {
  _store[sessionId] = ctx;
};

try {
  // if running from repo
  Wit = require('../').Wit;
  interactive = require('../').interactive;
} catch (e) {
  Wit = require('node-wit/lib').Wit;
  interactive = require('node-wit').interactive;
}

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Authorization', 'Bearer ${WIT_TOKEN}');
  next();
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

app.get('/chat', function (req, res) {
   const actions = [];
  const cb = (action) => actions.push(action);
  const {text, sessionId} = req.query;
  const engine = weatherBot(WIT_TOKEN, cb);
  engine.runActions(
    sessionId,
    text,
    getContext(sessionId)
  ).then(
    context => {
      res.status(200).json({context, actions});

      setContext(sessionId, context)
    },
    err => {
      console.log('[engine] error', err);
      res.status(500).send('something went wrong :\\');
    }
  );
})

var server = app.listen(8081, function () {

  var host = server.address().address
  var port = server.address().port
  sessionId = uuid.v4(); // temporary, remove later

})

function mapObject(obj, f) {
  return Object
    .keys(obj)
    .map(k => [k, f(obj[k], k)])
    .reduce(
      (newObj, [k, v]) => {
        newObj[k] = v;
        return newObj;
      },
      {}
    )
  ;
}

const checkEntityValue = (entities, entity) => {
  const val = entities && entities[entity] &&
    Array.isArray(entities[entity]) &&
    entities[entity].length > 0 &&
    entities[entity][0].value
  ;
  if (!val) {
    return null;
  }
  return typeof val === 'object' ? val.value : val;
};

function forecastFor(apiRes, location, dateTime) {
  var forecast = "";
  if(apiRes.error){
    return apiRes.error.message;
  }
  if (dateTime) {
    for (var i = apiRes.forecast.forecastday.length - 1; i >= 0; i--) {
      if(apiRes.forecast.forecastday[i].date == dateTime){
        var dayForecast = apiRes.forecast.forecastday[i];
        forecast = dayForecast.day.avgtemp_c + "°C" + ", " + dayForecast.day.condition.text + " in " + locationFor(apiRes);
        break;
      }
    }
  }
  else {
    forecast = apiRes.current.temp_c + "°C" + ", " + apiRes.current.condition.text + " in " + locationFor(apiRes);
  }
  
  if (forecast == "") {
    forecast = "not available for given date.";
  }
  return forecast;
}

const noop = () => {};

const withForecast = (ctx, forecast) => {
  ctx.forecast = forecast;
  return ctx;
}

function locationFor(apiRes) {
  if(apiRes.error){
    return "";
  }
  return apiRes.location.name;
}

const withLocation = (ctx, loc) => {
  ctx.location = loc;
  delete ctx.missingLocation;
  return ctx;
}

const noLocation = (ctx) => {
  ctx.missingLocation = true;
  delete ctx.forecast;
  return ctx;
}

const withAPIError = (ctx, err) => {
  ctx.forecast = "Weather data not available";
  return ctx;
}

function wrapActions(actions, cb) {
  return mapObject(
    actions,
    (f, k) => function () {
      const args = [].slice.call(arguments);
      cb({name: k, args})
      return f.apply(null, arguments);
    }
  );
}

function getForecast({context, entities}) {
    //console.log(entities);
    var location = checkEntityValue(entities, 'location');
    if (!location) return Promise.resolve(noLocation(context));

    var dateTime = checkEntityValue(entities, 'datetime')

    dateTime = dateTime? dateTime.substring(0, 10) : null;
    var isDatePresent = dateTime? true : false;

    return getWeatherFromAPI(location, isDatePresent).then(
        res => {
          return withLocation(
            withForecast(context, forecastFor(res,location,dateTime)),
            locationFor(res)
          );
        },
        err => withAPIError(withLocation(context, location), err)
      );
  }

  function resetContext({context}){
    delete context.forecast;
    delete context.location;
    return context;
  }

const actions = {
  send(request, response) {
    console.log('sending...', JSON.stringify(response));
    return Promise.resolve();
  },
  getForecast,
  resetContext,
  'null': ({sessionId, context, text, entities}) => {
      return Promise.resolve();
  }
};

function getWeatherFromAPI(location, isDatePresent){
  var days = isDatePresent? 10 : 0;

  return fetch(
      'http://api.apixu.com/v1/forecast.json?' + `key=${APPID}&q=${location}&days=${days}`
    ).then(res => res.json())
}

function weatherBot(accessToken, cb) {
  return new Wit({
    accessToken: WIT_TOKEN,
    actions: wrapActions(actions, cb || noop)
  });
}

const client = new Wit({
    accessToken: WIT_TOKEN,
    actions: wrapActions(actions, noop)
  });
interactive(client);