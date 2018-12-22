import {
  ignoredCallExpression,
  ignoredArrayExpression,
  getLastOperationTrackingResultCall,
  isInLeftPartOfAssignmentExpression,
  getBabelTypes
} from "../babelPluginHelpers";
import { ExecContext } from "../helperFunctions/ExecContext";
import { nullOnError, safelyReadProperty } from "../util";
import { getElAttributeValueOrigin } from "./domHelpers/addElOrigin";
import { htmlAdapter } from "../OperationTypes";

export const MemberExpression = <any>{
  argNames: ["object", "propName"],
  canInferResult: function(args, extraArgs) {
    // identifier will always return same value as var value
    return !!extraArgs.propertyValue;
  },
  shorthand: {
    fnName: "__mEx",
    getExec: doOperation => {
      return (object, propName, loc) => {
        return doOperation([object, propName], undefined, loc);
      };
    },
    visitor: (opArgs, astArgs, locAstNode) => {
      return ignoredCallExpression("__mEx", [
        ignoredArrayExpression(opArgs[0]),
        ignoredArrayExpression(opArgs[1]),
        locAstNode
      ]);
    }
  },
  exec: (args, astArgs, ctx: ExecContext, logData: any) => {
    var ret;
    const [objectArg, propNameArg] = args;
    var object = objectArg[0];
    var objectT = objectArg[1];
    var propertyName = propNameArg[0];
    let execCount = ctx.countOperations(() => {
      ret = object[propertyName];
    });

    // could execs instead of using Object.getOwnPropertyDescriptor
    // because counting is probably faster
    const isGetter = execCount > 0;

    let trackingValue;
    if (isGetter) {
      trackingValue = ctx.lastOpTrackingResult;
    } else {
      trackingValue = ctx.getObjectPropertyTrackingValue(object, propertyName);
    }

    const isInBrowser = typeof HTMLElement !== "undefined";
    if (
      isInBrowser &&
      object instanceof XMLHttpRequest &&
      propertyName === "responseText"
    ) {
      trackingValue = ctx.createOperationLog({
        operation: ctx.operationTypes.XMLHttpRequestResponse,
        args: {
          value: [ret],
          openCall: [
            "(OpenCall)",
            ctx.global["__xmlHttpRequests"][object.responseURL]
          ]
        },
        astArgs: {},
        result: ret,
        runtimeArgs: {
          url: object.responseURL
        },
        loc: logData.loc
      });
    } else if (
      isInBrowser &&
      !trackingValue &&
      object instanceof Node &&
      typeof propertyName !== "symbol"
    ) {
      if (
        typeof HTMLScriptElement !== "undefined" &&
        object instanceof HTMLScriptElement &&
        ["text", "textContent", "innerHTML"].includes(propertyName)
      ) {
        // Handle people putting e.g. templates into script tags

        const elOrigin =
          object.childNodes[0] && object.childNodes[0]["__elOrigin"];
        if (elOrigin && elOrigin.textValue) {
          // TODO: this trackingvalue should really be created when doing the el origin
          // mapping logic...
          trackingValue = ctx.createOperationLog({
            operation: htmlAdapter,
            runtimeArgs: elOrigin.textValue,
            args: {
              html: [null, elOrigin.textValue.trackingValue]
            }
          });
        }
      } else if (
        object instanceof HTMLElement &&
        // object.getAttribute() is illegal invocation on youtube somehow
        nullOnError(() => object.getAttribute(propertyName)) !== null &&
        // A bit icky, but it seems like a reasonable decision
        // Normally we want to see where a value was set, e.g. as part of some html
        // But input values lose that relationship when the user interacts with them (e.g. types
        // into text field) so the value attribute from DOM mapping may be different from
        // the actual property value
        // So while sometimes the value from the HTML might give a better origin we'll always
        // stop traversal at el.value instead
        propertyName !== "value"
      ) {
        if (object["__elOrigin"]) {
          const origin = getElAttributeValueOrigin(object, propertyName);
          if (origin) {
            trackingValue = ctx.createOperationLog({
              operation: htmlAdapter,
              runtimeArgs: origin,
              args: {
                html: [null, origin.trackingValue]
              }
            });
          }
        }
      } else if (
        safelyReadProperty(object, "nodeType") === Node.TEXT_NODE &&
        ["textContent", "nodeValue"].includes(propertyName)
      ) {
        if (object["__elOrigin"]) {
          const origin = object["__elOrigin"].textValue;
          if (origin) {
            trackingValue = ctx.createOperationLog({
              operation: htmlAdapter,
              runtimeArgs: origin,
              args: {
                html: [null, origin.trackingValue]
              }
            });
          }
        }
      }
    }
    logData.extraArgs = {
      propertyValue: [ret, trackingValue]
    };

    ctx.lastMemberExpressionResult = [object, objectT];

    return ret;
  },
  traverse(operationLog, charIndex) {
    const propNameAsNumber = parseFloat(
      operationLog.args.propName.result.primitive
    );
    if (
      operationLog.args.object &&
      operationLog.args.object.result.type === "string" &&
      !isNaN(propNameAsNumber)
    ) {
      return {
        operationLog: operationLog.args.object,
        charIndex: charIndex + propNameAsNumber
      };
    }
    return {
      operationLog: operationLog.extraArgs.propertyValue,
      charIndex: charIndex
    };
  },
  visitor(path) {
    if (isInLeftPartOfAssignmentExpression(path)) {
      return;
    }
    if (path.parent.type === "UpdateExpression") {
      return;
    }

    if (path.node.object.type === "Super") {
      // we can't super into a function so let's not try
      return;
    }

    // todo: dedupe this code
    var property;
    if (path.node.computed === true) {
      property = path.node.property;
    } else {
      if (path.node.property.type === "Identifier") {
        property = getBabelTypes().stringLiteral(path.node.property.name);
        property.loc = path.node.property.loc;
      }
    }

    const op = this.createNode!(
      [
        [path.node.object, getLastOperationTrackingResultCall()],
        [property, getLastOperationTrackingResultCall()]
      ],
      {},
      path.node.loc
    );

    return op;
  }
};
