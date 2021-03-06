import { DirectiveResponse, EndpointState } from '@vestibule-link/iot-types';
import { Directive } from "@vestibule-link/alexa-video-skill-types";


export type DirectiveRequest = {
    [NS in Directive.Namespaces]: {
        [N in keyof Directive.NamedMessage[NS]]:
        Directive.NamedMessage[NS][N] extends { payload: any }
        ? Directive.NamedMessage[NS][N]['payload']
        : never
    }
}
export type DirectiveHandlers = Partial<{
    [NS in Directive.Namespaces]:
    {
        supported: Array<keyof Directive.NamedMessage[NS]>
    }
    &
    {
        [N in DirectiveCommands<NS>]: DirectiveCommand<NS,N>
    }
}>

export type SupportedDirectives<K extends keyof DirectiveHandlers> = DirectiveHandlers[K]['supported']

export type DirectiveCommands<K extends keyof DirectiveHandlers> = keyof Directive.NamedMessage[K]

export type DirectiveCommand<NS extends Directive.Namespaces, N extends DirectiveCommands<NS>> = 
    Directive.NamedMessage[NS][N] extends { payload: any }
    ? {
        [DN in keyof DirectiveResponse[NS]]:
        DirectiveResponse[NS][DN] extends { payload: any }
        ? (payload: Directive.NamedMessage[NS][N]['payload']) => Promise<{
            payload: DirectiveResponse[NS][DN]['payload']
            state?: EndpointState
        }>
        : never
    }[keyof DirectiveResponse[NS]]
    : never