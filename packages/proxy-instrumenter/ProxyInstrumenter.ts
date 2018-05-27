var request = require("request");
var waitUntil = require("wait-until");
var fs = require("fs");
var Proxy = require("http-mitm-proxy");

function logWithPrefix(prefix) {
  return function log(...args) {
    args.unshift(prefix);
    console.log.apply(console, args);
  };
}

const log = logWithPrefix("[PROXY]");

////////////////////////

Error.stackTraceLimit = Infinity;

const spawn = require("threads").spawn;

// todo: multiple requests to same url will be cleared in one go for requestsInProgress right now

// var sourceMaps = {};
// var jsRequests = [];

/* note re enablecache:
there's always an in memory cache for the same url, but enable cache persists
the in memory cache
*/
export function startProxy(options) {
  const analysisDirectory = "",
    enableCache = false; // old fn arguments, don't think they're still needed
  //   var responseCache = {};
  //   if (enableCache) {
  //     console.log("Proxy cache enabled");
  //     console.time("Reading cache");
  //     try {
  //       console.time("Load response cache");
  //       responseCache = JSON.parse(fs.readFileSync("./cache.json"));
  //       console.timeEnd("Load response cache");
  //       console.log(Object.keys(responseCache));

  //       // also have separte sm cache, because the sm won't be in
  //       // response cache if it has never been requested
  //       sourceMaps = JSON.parse(fs.readFileSync("./sourceMapCache.json"));
  //     } catch (err) {
  //       console.log("Couldn't load existing cache");
  //     }

  //     console.timeEnd("Reading cache");
  //   }

  ////// //
  ////// //

  ////// //
  ////// //

  return new Promise(resolve => {
    var fesProxy = new FesProxy(options);
    fesProxy.start().then(() => {
      resolve(fesProxy);
    });
  });
}

function getUrl(ctx) {
  let protocol = ctx.isSSL ? "https" : "http";
  return (
    protocol +
    "://" +
    ctx.clientToProxyRequest.headers.host +
    ctx.clientToProxyRequest.url
  );
}

function checkIsJS(ctx) {
  return ctx.clientToProxyRequest.url
    .replace("?dontprocess", "")
    .split("?")[0]
    .endsWith(".js");
}

class FesProxy {
  urlCache = {};
  babelPluginOptions = {};
  instrumenterFilePath = "";
  constructor({ babelPluginOptions, instrumenterFilePath }) {
    this.instrumenterFilePath = instrumenterFilePath;
    this.proxy = Proxy();
    this.requestsInProgress = [];
    this.analysisDirectory = ""; // unused i think
    this.babelPluginOptions = babelPluginOptions;

    this.proxy.onError((ctx, err, errorKind) => {
      var url = "n/a";
      // ctx may be null
      if (ctx) {
        url = getUrl(ctx);
      }
      this.finishRequest(url);
      console.error("[PROXY]" + errorKind + " on " + url + ":", err);
    });

    this.proxy.onRequest((ctx, callback) => {
      let protocol = ctx.isSSL ? "https" : "http";
      var url = getUrl(ctx);

      log("Request: " + url);
      if (url === "http://example.com/verifyProxyWorks") {
        ctx.proxyToClientResponse.end("Confirmed proxy works!");
        return;
      }
      if (
        url.includes("google") ||
        url.includes("launchdarkly") ||
        url.includes("appspot")
      ) {
        // make it easier to debug stuff in China, otherwise getting pending requests forever
        log("sending empty response for google etc");
        ctx.proxyToClientResponse.statusCode = 500;
        ctx.proxyToClientResponse.end("");
        return;
      }

      this.requestsInProgress.push(url);

      if (ctx.clientToProxyRequest.url.indexOf())
        var isDontProcess = ctx.clientToProxyRequest.url.includes(
          "?dontprocess"
        );

      var isMap =
        url.split("?")[0].endsWith(".map") && !url.includes(".css.map");

      if (checkIsJS(ctx)) {
        var jsFetchStartTime = new Date();

        const finishJSRequest = (body, callback) => {
          if (!isDontProcess) {
            this.processCode(body, url).then(
              result => {
                this.finishRequest(url);
                ctx.proxyToClientResponse.end(new Buffer(result.code));
                callback();
              },
              err => {
                log("process code error", err);
                this.finishRequest(url);
                ctx.proxyToClientResponse.end(new Buffer(body));
                callback();
              }
            );
          } else {
            ctx.proxyToClientResponse.end(new Buffer(body));
            this.finishRequest(url);
            return;
          }
        };

        console.log("checking url cache for", url);
        if (this.urlCache[url]) {
          log("Url cache hit!");
          Object.keys(this.urlCache[url].headers).forEach(name => {
            var value = this.urlCache[url].headers[name];
            ctx.proxyToClientResponse.setHeader(name, value);
          });
          finishJSRequest(this.urlCache[url].body, function() {});
          return;
        }

        var mapUrl = url.replace(".js", ".js.map");

        ctx.use(Proxy.gunzip);

        var chunks = [];
        ctx.onResponseData(function(ctx, chunk, callback) {
          chunks.push(chunk);
          var chunkSizeInKb =
            Math.round(chunk.toString().length / 1024 * 10) / 10;
          setTimeout(function() {
            // log("got chunk", url, chunkSizeInKb + "kb");
          });

          return callback(null, null); // don't write chunks to client response
        });

        ctx.onResponseEnd((ctx, callback) => {
          var buffer = Buffer.concat(chunks);

          var body = buffer.toString();
          var msElapsed = new Date().valueOf() - jsFetchStartTime.valueOf();
          var speed = Math.round(buffer.byteLength / msElapsed / 1000 * 1000);
          log(
            "JS ResponseEnd",
            url,
            "Time:",
            msElapsed + "ms",
            "Size: ",
            buffer.byteLength / 1024 + "kb",
            " Speed",
            speed + "kb/s"
          );

          var contentTypeHeader =
            ctx.serverToProxyResponse.headers["content-type"];
          if (contentTypeHeader && contentTypeHeader.includes("text/html")) {
            log("file name looked like js but is text/html", url);
            ctx.proxyToClientResponse.write(new Buffer(body));
            return callback();
          }

          this.urlCache[url] = {
            body,
            headers: ctx.serverToProxyResponse.headers
          };

          finishJSRequest(body, callback);

          return;
        });
      }
      if (isMap) {
        this.getSourceMap(url).then(sourceMap => {
          ctx.proxyToClientResponse.end(JSON.stringify(sourceMap));
          this.finishRequest(url);
        });
        return;
      } else {
        ctx.onResponseEnd(function(ctx, callback) {
          return callback();
        });
      }
      return callback();
    });

    this.proxy.onResponseEnd((ctx, callback) => {
      if (checkIsJS(ctx)) {
        return callback();
      }
      this.finishRequest(getUrl(ctx));
      log(
        "resp end",
        getUrl(ctx),
        "#req still in progress:",
        this.requestsInProgress.length
      );
      return callback();
    });
  }

  start() {
    var port = 8081;
    this.proxy.listen({ port: port, sslCaDir: "./ca" });
    log("Listening on " + port);
    // Was having issues in CI, so make sure to wait for proxy to be ready
    return new Promise(resolve => {
      waitUntil()
        .interval(200)
        .times(100)
        .condition(cb => {
          this.proxiedFetchUrl("http://example.com/verifyProxyWorks").then(
            function(body) {
              cb(body === "Confirmed proxy works!");
            },
            function(err) {
              cb(false);
            }
          );
        })
        .done(function() {
          resolve();
        });
    });
  }

  registerEvalScript(url, code, babelResult) {
    // Original code here because it will still be processed later on!
    this.urlCache[url] = {
      headers: {},
      body: code
    };

    this.urlCache[url + "?dontprocess"] = {
      headers: {},
      body: code
    };

    const babelResultCode =
      babelResult.code + "\n//#sourceMappingURL=" + url + ".map";
    babelResult = JSON.parse(JSON.stringify(babelResult));
    babelResult.code = babelResultCode;
    this.setProcessCodeCache(babelResultCode, url, babelResult);
  }

  finishRequest(finishedUrl) {
    this.requestsInProgress = this.requestsInProgress.filter(
      url => url !== finishedUrl
    );
  }
  proxiedFetchUrl(url) {
    var r = request.defaults({ proxy: "http://127.0.0.1:8081" });
    return new Promise((resolve, reject) => {
      if (this.urlCache[url]) {
        resolve(this.urlCache[url].body);
      } else {
        r({ url, rejectUnauthorized: false }, function(error, response, body) {
          if (error) {
            reject(error);
          } else {
            resolve(body);
          }
        });
      }
    });
  }
  getSourceMap(url) {
    var jsUrl = url.replace(".js.map", ".js");
    console.time("Get sourceMap" + url);
    return new Promise(resolve => {
      this.proxiedFetchUrl(jsUrl).then(body => {
        this.processCode(body, jsUrl).then(function(result) {
          console.timeEnd("Get sourceMap" + url);
          resolve(result.map);
        });
      });
    });
  }

  requestProcessCode(body, url, babelPluginOptions) {
    console.log("requestproxceecode", url);
    return new Promise(resolve => {
      const RUN_IN_SAME_PROCESS = false;

      if (RUN_IN_SAME_PROCESS) {
        console.log("Running compilation in proxy process for debugging");
        var compile = require(this.instrumenterFilePath);
        compile({ body, url, babelPluginOptions }, resolve);
      } else {
        var compilerProcess = spawn(this.instrumenterFilePath);
        var path = require("path");
        compilerProcess
          .send({ body, url, babelPluginOptions })
          .on("message", function(response) {
            resolve(response);
            compilerProcess.kill();
          })
          .on("error", function(error) {
            log("worker error", error);
          });
      }
    });
  }

  processCodeCache = {};
  setProcessCodeCache(body, url, result) {
    var cacheKey = body + url;
    this.processCodeCache[cacheKey] = result;
  }

  processCode(body, url) {
    var cacheKey = body + url;
    if (this.processCodeCache[cacheKey]) {
      log("cache hit", url);
      return Promise.resolve(this.processCodeCache[cacheKey]);
    }
    return this.requestProcessCode(body, url, this.babelPluginOptions).then(
      response => {
        var { code, map } = response;
        var result = { code, map };
        this.setProcessCodeCache(body, url, result);
        return Promise.resolve(result);
      }
    );
  }

  hasPendingRequests() {
    return this.requestsInProgress.length > 0;
  }
  close() {
    this.proxy.close();
  }
}
