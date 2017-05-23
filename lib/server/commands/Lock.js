"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var WebDAVRequest_1 = require("../WebDAVRequest");
var IResource_1 = require("../../resource/IResource");
var LockScope_1 = require("../../resource/lock/LockScope");
var LockKind_1 = require("../../resource/lock/LockKind");
var LockType_1 = require("../../resource/lock/LockType");
var Errors_1 = require("../../Errors");
var Lock_1 = require("../../resource/lock/Lock");
var XML_1 = require("../../helper/XML");
var path = require("path");
function default_1(arg, callback) {
    try {
        if (!arg.user) {
            arg.setCode(WebDAVRequest_1.HTTPCodes.Forbidden);
            callback();
            return;
        }
        var xml = XML_1.XML.parse(arg.data);
        var root = xml.find('DAV:lockinfo');
        var scope = new LockScope_1.LockScope(root.find('DAV:lockscope').elements[0].name.substr(4).toLowerCase());
        var type_1 = new LockType_1.LockType(root.find('DAV:locktype').elements[0].name.substr(4).toLowerCase());
        var ownerElement = root.find('DAV:owner');
        var owner_1 = ownerElement ? ownerElement.elements : null;
        var lock_1 = new Lock_1.Lock(new LockKind_1.LockKind(scope, type_1, arg.server.options.lockTimeout), arg.user, owner_1);
        arg.getResource(function (e, r) {
            if (e === Errors_1.Errors.ResourceNotFound) {
                arg.server.getResourceFromPath(arg.path.getParent(), function (e, r) {
                    if (e) {
                        arg.setCode(e === Errors_1.Errors.ResourceNotFound ? WebDAVRequest_1.HTTPCodes.Conflict : WebDAVRequest_1.HTTPCodes.InternalServerError);
                        callback();
                        return;
                    }
                    if (!r.fsManager) {
                        arg.setCode(WebDAVRequest_1.HTTPCodes.InternalServerError);
                        callback();
                        return;
                    }
                    arg.requirePrivilege(['canAddChild'], r, function () {
                        var resource = r.fsManager.newResource(arg.uri, path.basename(arg.uri), IResource_1.ResourceType.File, r);
                        arg.requirePrivilege(['canCreate', 'canWrite'], resource, function () {
                            resource.create(function (e) {
                                if (e) {
                                    arg.setCode(WebDAVRequest_1.HTTPCodes.InternalServerError);
                                    callback();
                                    return;
                                }
                                r.addChild(resource, function (e) {
                                    if (e)
                                        arg.setCode(WebDAVRequest_1.HTTPCodes.InternalServerError);
                                    else
                                        arg.setCode(WebDAVRequest_1.HTTPCodes.Created);
                                    callback();
                                });
                            });
                        });
                    });
                });
                return;
            }
            if (e) {
                arg.setCode(WebDAVRequest_1.HTTPCodes.InternalServerError);
                callback();
                return;
            }
            arg.requirePrivilege(['canSetLock'], r, function () {
                r.setLock(lock_1, function (e) {
                    if (e) {
                        arg.setCode(WebDAVRequest_1.HTTPCodes.Locked);
                        callback();
                        return;
                    }
                    var prop = XML_1.XML.createElement('D:prop', {
                        'xmlns:D': 'DAV:'
                    });
                    var activelock = prop.ele('D:lockdiscovery').ele('D:activelock');
                    activelock.ele('D:locktype').ele(type_1.value);
                    activelock.ele('D:lockscope').ele(type_1.value);
                    activelock.ele('D:locktoken').ele('D:href').add(lock_1.uuid);
                    activelock.ele('D:lockroot').add(arg.fullUri());
                    activelock.ele('D:depth').add('infinity');
                    activelock.ele('D:owner').add(owner_1);
                    activelock.ele('D:timeout').add('Second-' + lock_1.lockKind.timeout);
                    arg.response.setHeader('Lock-Token', lock_1.uuid);
                    arg.setCode(WebDAVRequest_1.HTTPCodes.OK);
                    arg.writeXML(prop);
                    callback();
                });
            });
        });
    }
    catch (ex) {
        arg.setCode(WebDAVRequest_1.HTTPCodes.BadRequest);
        callback();
        return;
    }
}
exports.default = default_1;