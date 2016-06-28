var http = require("http");
var fs = require("fs");
var endsWith = require('ends-with');
var stringContains = require("string-contains");
var processJavaScriptCode = require("./process-javascript-code")

http.createServer(handleRequest).listen(8888)

function handleRequest(request, response){
    var path = "." + request.url.split("?")[0]
    console.log("Request for path ", path)
    if (endsWith(path, ".js.map")){
        path = path.substr(0, path.length - ".map".length)
    }

    if (fs.existsSync(path)){
        var fileContents = fs.readFileSync(path).toString()

        if (endsWith(request.url, ".html")){
            var scriptTagHtml = '<script src="dontprocess/string-trace.js"></script>'
            if (stringContains(fileContents, "<head>")){
                fileContents = fileContents.replace("<head>", "<head>" + scriptTagHtml)
            } else {
                fileContents = scriptTagHtml + fileContents
            }
        }

        if ((endsWith(request.url, ".js") || endsWith(request.url, ".js.map")) &&
            !stringContains(request.url, "/dontprocess") &&
            !stringContains(request.url, "/vis") &&
            !stringContains(request.url, "?dontprocess=yes")
        ) {
            var jsFileName = path.split("/")[path.split("/").length - 1]
            if (endsWith(request.url, ".js")) {
                var res = processJavaScriptCode(fileContents)
                fileContents = res.code
                fileContents += "\n//# sourceMappingURL=" + jsFileName + ".map"

            }
            if (endsWith(request.url, ".js.map")){
                fileContents = JSON.stringify(processJavaScriptCode(fileContents, {filename: jsFileName}).map, null, 4)
            }

        }
        response.write(fileContents)
    } else {
        response.writeHead(404, {"Content-Type": "text/plain"});
        response.write("not found")
    }
    response.end();
}
