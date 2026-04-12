export class CodecError extends Error {
    constructor(msg: string, options?: ErrorOptions) {
        super(msg, options);
        this.name = this.constructor.name;
    }
}