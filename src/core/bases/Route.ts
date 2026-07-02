import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { type IHeart } from '#core/heart/index.js';
import { getLogger, type Logger } from '#core/utils/logger.js';

export abstract class BaseRoute {
    public readonly router: Router;
    #heart: IHeart;
    #logger?: Logger;
    public abstract readonly basePath: string;
    constructor(heart: IHeart) {
        this.#heart = heart;
        this.router = Router({ strict: false, mergeParams: true });
    }
    public _buildRouter(): Router {
        this.register();
        return this.router;
    }
    protected get heart(): IHeart {
        return this.#heart;
    }
    protected get log(): Logger {
        if (!this.#logger) {
            this.#logger = getLogger(`Route:[${this.basePath}]`);
        }
        return this.#logger;
    }
    protected abstract register(): void;
    protected asyncHandler<Req extends Request = Request>(
        fn: (req: Req, res: Response, next: NextFunction) => Promise<any>,
    ): RequestHandler {
        return (req: Request, res: Response, next: NextFunction) => {
            Promise.resolve(fn(req as Req, res, next)).catch(next);
        };
    }
}