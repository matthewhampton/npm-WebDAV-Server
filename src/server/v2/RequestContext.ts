import { XML, XMLElement } from '../../helper/XML'
import { parseIfHeader } from '../../helper/v2/IfParser'
import { WebDAVServer } from './webDAVServer/WebDAVServer'
import { HTTPCodes } from '../HTTPCodes'
import { FileSystem } from '../../manager/v2/fileSystem/FileSystem'
import { ResourceType, ReturnCallback } from '../../manager/v2/fileSystem/CommonTypes'
import { Resource } from '../../manager/v2/fileSystem/Resource'
import { Path } from '../../manager/v2/Path'
import { Errors } from '../../Errors'
import { IUser } from '../../user/v2/IUser'
import * as http from 'http'
import * as url from 'url'

export class RequestContextHeaders
{
    contentLength : number
    isSource : boolean
    depth : number
    host : string

    constructor(protected headers : { [name : string] : string })
    {
        this.isSource = this.find('source', 'F').toUpperCase() === 'T' || this.find('translate', 'T').toUpperCase() === 'F';
        this.host = this.find('Host', 'localhost');

        const depth = this.find('Depth');
        try
        {
            if(depth.toLowerCase() === 'infinity')
                this.depth = -1;
            else
                this.depth = Math.max(-1, parseInt(depth, 10));
        }
        catch(_)
        {
            this.depth = undefined;
        }
        
        try
        {
            this.contentLength = Math.max(0, parseInt(this.find('Content-length', '0'), 10));
        }
        catch(_)
        {
            this.contentLength = 0;
        }
    }

    find(name : string, defaultValue : string = null) : string
    {
        name = name.replace(/(-| )/g, '').toLowerCase();

        for(const k in this.headers)
            if(k.replace(/(-| )/g, '').toLowerCase() === name)
            {
                const value = this.headers[k].trim();
                if(value.length !== 0)
                    return value;
            }
        
        return defaultValue;
    }

    findBestAccept(defaultType : string = 'xml') : string
    {
        const accepts = this.find('Accept', 'text/xml').split(',');
        const regex = {
            'xml': /[^a-z0-9A-Z]xml$/,
            'json': /[^a-z0-9A-Z]json$/
        };

        for(const value of accepts)
        {
            for(const name in regex)
                if(regex[name].test(value))
                    return name;
        }

        return defaultType;
    }
}

export interface RequestedResource
{
    path : Path
    uri : string
}

export interface RequestContextExternalOptions
{
    headers ?: { [name : string] : string }
    url ?: string
    user ?: IUser
}
export class DefaultRequestContextExternalOptions implements RequestContextExternalOptions
{
    headers : { [name : string] : string } = {
        host: 'localhost'
    }
    url : string = '/'
    user : IUser = {
        isAdministrator: true,
        isDefaultUser: false,
        password: null,
        uid: '-1',
        username: '_default_super_admin_'
    }
}

export class RequestContext
{
    requested : RequestedResource
    headers : RequestContextHeaders
    server : WebDAVServer
    user : IUser
    
    protected constructor(server : WebDAVServer, uri : string, headers : { [name : string] : string })
    {
        this.headers = new RequestContextHeaders(headers);
        this.server = server;
        
        uri = url.parse(uri).pathname;
        this.requested = {
            uri,
            path: new Path(uri)
        };
    }
    
    getResource(callback : ReturnCallback<Resource>)
    getResource(path : Path | string, callback : ReturnCallback<Resource>)
    getResource(_path : Path | string | ReturnCallback<Resource>, _callback ?: ReturnCallback<Resource>)
    {
        const path = _callback ? new Path(_path as Path | string) : this.requested.path;
        const callback = _callback ? _callback : _path as ReturnCallback<Resource>;

        this.server.getResource(this, path, callback);
    }

    getResourceSync(path ?: Path | string) : Resource
    {
        path = path ? path : this.requested.path;
        return this.server.getResourceSync(this, path);
    }

    fullUri(uri : string = null)
    {
        if(!uri)
            uri = this.requested.uri;
        
        return (this.prefixUri() + uri).replace(/([^:])\/\//g, '$1/');
    }

    prefixUri()
    {
        return 'http://' + this.headers.host.replace('/', '');
    }
}

export class ExternalRequestContext extends RequestContext
{
    static create(server : WebDAVServer) : ExternalRequestContext
    static create(server : WebDAVServer, callback : (error : Error, ctx : ExternalRequestContext) => void) : ExternalRequestContext
    static create(server : WebDAVServer, options : RequestContextExternalOptions) : ExternalRequestContext
    static create(server : WebDAVServer, options : RequestContextExternalOptions, callback : (error : Error, ctx : ExternalRequestContext) => void) : ExternalRequestContext
    static create(server : WebDAVServer, _options ?: RequestContextExternalOptions | ((error : Error, ctx : ExternalRequestContext) => void), _callback ?: (error : Error, ctx : ExternalRequestContext) => void) : ExternalRequestContext
    {
        const defaultValues = new DefaultRequestContextExternalOptions();

        const options = _options && _options.constructor !== Function ? _options as RequestContextExternalOptions : defaultValues;
        const callback = _callback ? _callback : _options && _options.constructor === Function ? _options as ((error : Error, ctx : ExternalRequestContext) => void) : () => {};

        if(defaultValues !== options)
        {
            for(const name in defaultValues)
                if(options[name] === undefined)
                    options[name] = defaultValues[name];
        }

        const ctx = new ExternalRequestContext(server, options.url, options.headers);

        if(options.user)
        {
            ctx.user = options.user;
            process.nextTick(() => callback(null, ctx));
        }

        return ctx;
    }
}

export class HTTPRequestContext extends RequestContext
{
    responseBody : string
    request : http.IncomingMessage
    response : http.ServerResponse
    exit : () => void

    protected constructor(
        server : WebDAVServer,
        request : http.IncomingMessage,
        response : http.ServerResponse,
        exit : () => void
    ) {
        super(server, request.url, request.headers);

        this.responseBody = undefined;
        this.response = response;
        this.request = request;
        this.exit = exit;
    }

    static create(server : WebDAVServer, request : http.IncomingMessage, response : http.ServerResponse, callback : (error : Error, ctx : HTTPRequestContext) => void)
    {
        const ctx = new HTTPRequestContext(server, request, response, null);
        response.setHeader('DAV', '1,2');
        response.setHeader('Server', server.options.serverName + '/' + server.options.version);

        ctx.askForAuthentication(false, (e) => {
            if(e)
            {
                callback(e, ctx);
                return;
            }

            server.httpAuthentication.getUser(ctx, (e, user) => {
                ctx.user = user;
                if(e && e !== Errors.UserNotFound)
                {
                    if(server.options.requireAuthentification || e !== Errors.MissingAuthorisationHeader)
                        return callback(e, ctx);
                }

                if(server.options.requireAuthentification && (!user || user.isDefaultUser || e === Errors.UserNotFound))
                    return callback(Errors.MissingAuthorisationHeader, ctx);

                server.getFileSystem(ctx.requested.path, (fs, _, subPath) => {
                    fs.type(ctx, subPath, (e, type) => {
                        if(e)
                            type = undefined;

                        setAllowHeader(type);
                    })
                })
            })
        })

        function setAllowHeader(type ?: ResourceType)
        {
            const allowedMethods = [];
            for(const name in server.methods)
            {
                const method = server.methods[name];
                if(!method.isValidFor || method.isValidFor(ctx, type))
                    allowedMethods.push(name.toUpperCase());
            }

            response.setHeader('Allow', allowedMethods.join(','));
            callback(null, ctx);
        }
    }

    noBodyExpected(callback : () => void)
    {
        if(this.server.options.strictMode && this.headers.contentLength !== 0)
        {
            this.setCode(HTTPCodes.UnsupportedMediaType);
            this.exit();
        }
        else
            callback();
    }

    checkIfHeader(resource : Resource, callback : () => void)
    checkIfHeader(fs : FileSystem, path : Path, callback : () => void)
    checkIfHeader(_fs : FileSystem | Resource, _path : Path | (() => void), _callback ?: () => void)
    {
        const fs = _callback ? _fs as FileSystem : null;
        const path = _callback ? _path as Path : null;
        let resource = _callback ? null : _fs as Resource;
        const callback = _callback ? _callback : _path as () => void;

        const ifHeader = this.headers.find('If');

        if(!ifHeader)
        {
            callback();
            return;
        }

        if(!resource)
        {
            resource = fs.resource(this, path);
        }

        parseIfHeader(ifHeader)(this, resource, (e, passed) => {
            if(e)
            {
                this.setCode(HTTPCodes.InternalServerError);
                this.exit();
            }
            else if(!passed)
            {
                this.setCode(HTTPCodes.PreconditionFailed);
                this.exit();
            }
            else
                callback();
        });
    }

    askForAuthentication(checkForUser : boolean, callback : (error : Error) => void)
    {
        if(checkForUser && this.user !== null && !this.user.isDefaultUser)
        {
            callback(Errors.AlreadyAuthenticated);
            return;
        }

        const auth = this.server.httpAuthentication.askForAuthentication();
        for(const name in auth)
            this.response.setHeader(name, auth[name]);
        callback(null);
    }

    writeBody(xmlObject : XMLElement | object)
    {
        let content = XML.toXML(xmlObject);
        
        switch(this.headers.findBestAccept())
        {
            default:
            case 'xml':
                this.response.setHeader('Content-Type', 'application/xml; charset="utf-8"');
                this.response.setHeader('Content-Length', content.length.toString());
                this.response.write(content);
                break;
                
            case 'json':
                content = XML.toJSON(content);
                this.response.setHeader('Content-Type', 'application/json; charset="utf-8"');
                this.response.setHeader('Content-Length', content.length.toString());
                this.response.write(content);
                break;
        }

        this.responseBody = content;
    }
    
    setCode(code : number, message ?: string)
    {
        if(!message)
            message = http.STATUS_CODES[code];
        if(!message)
        {
            this.response.statusCode = code;
        }
        else
        {
            this.response.statusCode = code;
            this.response.statusMessage = message;
        }
    }
    static defaultStatusCode(error : Error) : number
    {
        let code = null;

        if(error === Errors.ResourceNotFound)
            code = HTTPCodes.NotFound;
        else if(error === Errors.Locked)
            code = HTTPCodes.Locked;
        else if(error === Errors.BadAuthentication)
            code = HTTPCodes.Unauthorized;
        else if(error === Errors.NotEnoughPrivilege)
            code = HTTPCodes.Unauthorized;
        else if(error === Errors.ResourceAlreadyExists)
            code = HTTPCodes.Conflict;
        else if(error === Errors.IntermediateResourceMissing)
            code = HTTPCodes.Conflict;
        else if(error === Errors.WrongParentTypeForCreation)
            code = HTTPCodes.Conflict;
        else if(error === Errors.InsufficientStorage)
            code = HTTPCodes.InsufficientStorage;
        else if(error === Errors.Forbidden)
            code = HTTPCodes.Forbidden;
        
        return code;
    }
    setCodeFromError(error : Error) : boolean
    {
        const code = HTTPRequestContext.defaultStatusCode(error);

        if(!code)
            return false;
        
        this.setCode(code);
        return true;
    }
}