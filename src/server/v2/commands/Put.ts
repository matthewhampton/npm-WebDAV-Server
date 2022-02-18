import { HTTPCodes, HTTPMethod, HTTPRequestContext } from '../WebDAVRequest'
import { ResourceType, OpenWriteStreamMode } from '../../../manager/v2/fileSystem/CommonTypes'
import { Readable } from 'stream'
import { Errors } from '../../../Errors'
import * as LOG from '../../../helper/v2/logger';

export default class implements HTTPMethod
{
    isValidFor(ctx : HTTPRequestContext, type : ResourceType)
    {
        return !type || type.isFile;
    }

    chunked(ctx : HTTPRequestContext, inputStream : Readable, callback : () => void)
    {
        const targetSource = ctx.headers.isSource;
        // LOG.info(`PUT.chunked ${ctx.request.url} START `);

        ctx.getResource((e, r) => {
            ctx.checkIfHeader(r, () => {
                //ctx.requirePrivilege(targetSource ? [ 'canSource', 'canWrite' ] : [ 'canWrite' ], r, () => {
                    let mode : OpenWriteStreamMode = 'canCreate';
                    r.type((e, type) => process.nextTick(() => {
                        if(e === Errors.ResourceNotFound)
                        {
                            mode = 'mustCreate';
                        }
                        else if(e)
                        {
                            if(!ctx.setCodeFromError(e))
                                ctx.setCode(HTTPCodes.InternalServerError);
                            return callback();
                        }
                        else if(!type.isFile)
                        {
                            ctx.setCode(HTTPCodes.MethodNotAllowed);
                            return callback();
                        }

                        // LOG.info(`PUT.chunked ${ctx.request.url} openWriteStream BEFORE`);
                        r.openWriteStream(mode, targetSource, ctx.headers.contentLength, (e, wStream, created) => {
                            // LOG.info(`PUT.chunked ${ctx.request.url} openWriteStream STARTED`);
                            wStream.on('finish', (e) => {
                                LOG.info(`PUT.chunked ${ctx.request.url} wStream onFinish`);
                            });
                            wStream.on('error', (e) => {
                                LOG.info(`PUT.chunked ${ctx.request.url} wStream onError`);
                                if(!ctx.setCodeFromError(e))
                                    ctx.setCode(HTTPCodes.InternalServerError)
                                callback();
                            });
                            // wStream.on('pipe', () => { LOG.info(`PUT.chunked ${ctx.request.url} wStream onPipe`); });
                            // wStream.on('unpipe', () => { LOG.info(`PUT.chunked ${ctx.request.url} wStream onUnPipe`); });
                            // wStream.on('close', () => { LOG.info(`PUT.chunked ${ctx.request.url} wStream onClose`); });
                            // wStream.on('drain', () => { LOG.info(`PUT.chunked ${ctx.request.url} wStream onDrain`); });
                            
                            // inputStream.on('resume', () => { LOG.info(`PUT.chunked ${ctx.request.url} inputStream onResume`); });
                            // inputStream.on('pause', () => { LOG.info(`PUT.chunked ${ctx.request.url} inputStream onPause`); });
                            // inputStream.on('error', () => { LOG.info(`PUT.chunked ${ctx.request.url} inputStream onError`); });
                            // inputStream.on('end', () => { LOG.info(`PUT.chunked ${ctx.request.url} inputStream onEnd`); });
                            // inputStream.on('close', () => { LOG.info(`PUT.chunked ${ctx.request.url} inputStream onClose`); });
                
                            if(e)
                            {
                                if(!ctx.setCodeFromError(e))
                                    ctx.setCode(e === Errors.IntermediateResourceMissing || e === Errors.WrongParentTypeForCreation ? HTTPCodes.Conflict : HTTPCodes.InternalServerError);
                                return callback();
                            }

                            // LOG.info(`PUT.chunked ${ctx.request.url} inputStream.pipe(wStream) BEFORE`);
                            inputStream.pipe(wStream);
                            // LOG.info(`PUT.chunked ${ctx.request.url} inputStream.pipe(wStream) AFTER`);
                        }, (e) => {
                            LOG.info(`PUT.chunked ${ctx.request.url} callbackComplete`);
                            if(e)
                                ctx.setCode(HTTPCodes.InternalServerError);
                            else
                                ctx.setCode(HTTPCodes.OK);
                            callback();
                        })
                    }))
                //})
            })
        })
    }
}
