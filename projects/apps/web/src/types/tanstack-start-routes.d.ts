import type { AnyContext, AnyRoute } from '@tanstack/react-router';

type StartRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ANY';

type StartRouteHandlerContext = {
    request: Request;
    params: Record<string, string>;
    context: unknown;
};

type StartRouteHandler = (context: StartRouteHandlerContext) => Response | Promise<Response>;

type StartRouteHandlerEntry =
    | StartRouteHandler
    | {
          handler?: StartRouteHandler;
          middleware?: readonly unknown[];
      };

type StartRouteHandlers = Partial<Record<StartRouteMethod, StartRouteHandlerEntry>>;

type StartRouteHandlersFactory = (input: {
    createHandlers: <THandlers extends StartRouteHandlers>(handlers: THandlers) => THandlers;
}) => StartRouteHandlers;

type StartServerRouteOptions = {
    handlers?: StartRouteHandlers | StartRouteHandlersFactory;
    middleware?: readonly unknown[];
};

declare module '@tanstack/router-core' {
    interface FilebaseRouteOptionsInterface<
        TRegister,
        TParentRoute extends AnyRoute = AnyRoute,
        TId extends string = string,
        TPath extends string = string,
        TSearchValidator = undefined,
        TParams = {},
        TLoaderDeps extends Record<string, any> = {},
        TLoaderFn = undefined,
        TRouterContext = {},
        TRouteContextFn = AnyContext,
        TBeforeLoadFn = AnyContext,
        TRemountDepsFn = AnyContext,
        TSSR = unknown,
        TServerMiddlewares = unknown,
        THandlers = undefined,
    > {
        server?: StartServerRouteOptions;
    }
}
