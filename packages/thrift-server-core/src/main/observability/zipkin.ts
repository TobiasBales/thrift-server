import { EventEmitter } from 'events'

import {
    BatchRecorder,
    ConsoleRecorder,
    Context,
    ExplicitContext,
    JsonEncoder,
    jsonEncoder,
    Recorder,
    sampler,
    TraceId,
    Tracer,
} from 'zipkin'

import {
    ZipkinHeaders,
} from './constants'

import { HttpLogger } from 'zipkin-transport-http'

import {
    IEventLoggers,
    IZipkinTracerConfig,
} from './types'

import { IRequestHeaders } from '../types'

class MaybeMap<K, V> extends Map<K, V> {
    public getOrElse(key: K, orElse: () => V): V {
        const value: V | undefined = this.get(key)
        if (value === undefined) {
            const newValue: V = orElse()
            this.set(key, newValue)
            return newValue

        } else {
            return value
        }
    }
}

interface IHttpLoggerOptions {
    endpoint: string
    httpInterval?: number
    httpTimeout?: number,
    headers?: IRequestHeaders
    jsonEncoder?: JsonEncoder
}

// Save tracers by service name
const TRACER_CACHE: MaybeMap<string, Tracer> = new MaybeMap()

function applyEventLoggers<T extends EventEmitter>(emitter: T, eventLoggers: IEventLoggers): void {
    for (const key in eventLoggers) {
        if (eventLoggers.hasOwnProperty(key)) {
            emitter.on(key, eventLoggers[key])
        }
    }
}

/**
 * `http://localhost:9411/api/v1/spans`
 */
function recorderForOptions(options: IZipkinTracerConfig): Recorder {
    if (options.endpoint !== undefined) {
        const httpOptions: IHttpLoggerOptions = {
            endpoint: options.endpoint,
            headers: options.headers,
            httpInterval: options.httpInterval,
            httpTimeout: options.httpTimeout,
            jsonEncoder: options.zipkinVersion === 'v2' ? jsonEncoder.JSON_V2 : jsonEncoder.JSON_V1,
        }

        const httpLogger: any = new HttpLogger(httpOptions)

        if (options.eventLoggers) {
            applyEventLoggers(httpLogger, options.eventLoggers)
        }

        return new BatchRecorder({ logger: httpLogger })

    } else {
        return new ConsoleRecorder()
    }
}

export function getHeadersForTraceId(traceId?: TraceId): { [name: string]: any } {
    if (traceId !== null && traceId !== undefined) {
        const headers: { [name: string]: any } = {}
        headers[ZipkinHeaders.TraceId] = traceId.traceId
        headers[ZipkinHeaders.SpanId] = traceId.spanId
        headers[ZipkinHeaders.ParentId] = traceId.parentId || ''

        traceId.sampled.ifPresent((sampled: boolean) => {
            headers[ZipkinHeaders.Sampled] = sampled ? '1' : '0'
        })

        return headers
    } else {
        return {}
    }
}

export function getTracerForService(serviceName: string, options: IZipkinTracerConfig = {}): Tracer {
    return TRACER_CACHE.getOrElse(serviceName, () => {
        const ctxImpl: Context<TraceId> = new ExplicitContext()
        const recorder: Recorder = recorderForOptions(options)
        return new Tracer({
            ctxImpl,
            recorder,
            sampler: new sampler.CountingSampler(
                (options.debug) ?
                    100 :
                    (options.sampleRate !== undefined) ?
                        options.sampleRate :
                        0.1,
            ),
            localServiceName: serviceName, // name of this application
        })
    })
}
