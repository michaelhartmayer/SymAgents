import { Logger } from './logger';

describe('Logger', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it('should log info messages', () => {
        Logger.info('test message');
        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should log success messages', () => {
        Logger.success('test message');
        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should log warning messages', () => {
        Logger.warn('test message');
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    });

    it('should log error messages', () => {
        Logger.error('test message');
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should log error messages with error object', () => {
        const error = new Error('test error');
        Logger.error('test message', error);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

    it('should log action messages', () => {
        Logger.action('test message');
        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });
});
