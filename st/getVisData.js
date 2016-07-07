import {disableTracing} from "../src/tracing/tracing"


import whereDoesCharComeFrom from "../src/whereDoesCharComeFrom"
import getRootOriginAtChar from "../src/getRootOriginAtChar"
import { OriginPath, FromJSView } from "../src/ui/ui"
var _ = require("underscore")
var $ = require("jquery")
import exportElementOrigin from "../src/export-element-origin"
import {getDefaultSourceCache} from "../src/resolve-frame"


var ReactDOM = require("react-dom")
var React = require("react")

setTimeout(function(){
    if (window.isSerializedDomPage){
        doneRenderingApp()
    } else {
        setTimeout(function(){
            if (window.isVis) {
                return;
            }

            doneRenderingApp()
        }, 4000)

    }
}, 100)

function doneRenderingApp(){
    disableTracing()

    if (!window.isSerializedDomPage){
        // saveAndSerializeDomState()
    }

    var windowJQuery = window.jQuery

    var link = document.createElement("link")
    link.setAttribute("rel", "stylesheet")
    link.setAttribute("href", "/fromjs-internals/fromjs.css")
    document.body.appendChild(link)

    var container = document.createElement("div")
    var component;

    ReactDOM.render(<FromJSView ref={(c) => component = c}/>, container)
    document.body.appendChild(container)

    function shouldHandle(e){
        if ($(e.target).closest("#fromjs").length !== 0){
            return false
        }
        if ($(e.target).is("html, body")){
            return false
        }
        return true
    }

    windowJQuery("*").off()
    $("*").click(function(e){
        if (!shouldHandle(e)) {return}
        e.stopPropagation();
        e.preventDefault();
        component.display(this)
    })
    $("*").mouseenter(function(e){
        if (!shouldHandle(e)) {return}
        e.stopPropagation()
        component.setPreviewEl(e.target)
    })
    $("*").mouseleave(function(e){
        if (!shouldHandle(e)) {return}
        component.setPreviewEl(null)
    })



        console.log("k")


    return
}

window.saveAndSerializeDomState = saveAndSerializeDomState
function saveAndSerializeDomState(){

    var sourceCache = getDefaultSourceCache()

    $("html").find("*")
      .contents()
      .filter(function() {
        return this.nodeType === 3; //Node.TEXT_NODE
      }).each(function(){
          var span = $("<span>")
          span.attr("fromjs-text-node-converted-to-span", "true")
          span[0].textContent = this.textContent
          span[0].__elOrigin = this.__elOrigin

          $(this).replaceWith(span)
      });

    var elsWithOrigin = jQuery("*").filter(function(){
        return this.__elOrigin
    })
    var id=1;

    elsWithOrigin.each(function(){
        var el = this;
        $(el).attr("fromjs-id", id)
        id++;
    })
    var elOrigins = {}
    elsWithOrigin.each(function(){
        var el = this;

        var serializedElOrigin = {};
        for (var key in el.__elOrigin) {
            if (key === "contents") {
                var contents = el.__elOrigin[key];
                serializedElOrigin[key] = contents.map(function(el){
                    return {elId: $(el).attr("fromjs-id")}
                })
            } else {
                serializedElOrigin[key] = el.__elOrigin[key]
            }

        }
        elOrigins[$(el).attr("fromjs-id")] = serializedElOrigin

    })

    var serializedState = {
        html: document.body.parentElement.innerHTML,
        elOrigins: elOrigins,
        sourceCache: sourceCache,
        fromJSDynamicFileOrigins: window.fromJSDynamicFileOrigins
    }
    console.log("state size", JSON.stringify(serializedState).length)
    window.serializedState = serializedState
    localStorage.setItem("domState", JSON.stringify(serializedState))

    document.body.innerHTML = "Done"
}
