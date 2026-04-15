export class IntegrityError extends Error { 
    constructor(msg: string, options?: ErrorOptions) { 
        super(msg, options); 
        this.name = this.constructor.name; 
    } 
}
export class ManifestSignatureError extends IntegrityError {}
export class FileTamperingError extends IntegrityError {}
export class VaultMissingKeyError extends IntegrityError {}