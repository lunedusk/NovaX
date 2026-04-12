export class VaultError extends Error { 
    constructor(msg: string) { 
        super(msg); 
        this.name = this.constructor.name; 
    } 
}
export class VaultFormatError extends VaultError {}
export class VaultIntegrityError extends VaultError {}
export class VaultConfigurationError extends VaultError {}