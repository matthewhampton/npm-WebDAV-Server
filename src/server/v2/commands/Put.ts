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
        // LOG.info('PUT chunked START');

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

                        // LOG.info('PUT.chunked openWriteStream BEFORE');
                        r.openWriteStream(mode, targetSource, ctx.headers.contentLength, (e, wStream, created) => {
                            // LOG.info('PUT.chunked openWriteStream STARTED');
                            if(e)
                            {
                                if(!ctx.setCodeFromError(e))
                                    ctx.setCode(e === Errors.IntermediateResourceMissing || e === Errors.WrongParentTypeForCreation ? HTTPCodes.Conflict : HTTPCodes.InternalServerError);
                                return callback();
                            }

                            // LOG.info('PUT.chunked inputStream.pipe(wStream) BEFORE');
                            inputStream.pipe(wStream);
                            wStream.on('finish', (e) => {
                                LOG.info('PUT.chunked wStream onFinish');
                            });
                            wStream.on('error', (e) => {
                                if(!ctx.setCodeFromError(e))
                                    ctx.setCode(HTTPCodes.InternalServerError)
                                callback();
                            });
                        }, (e) => {
                            LOG.info('PUT.chunked callbackComplete');
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
