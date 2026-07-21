export class Type {
    static check(argObj, expectedType) {
        if (typeof argObj !== 'object' || argObj === null || Array.isArray(argObj))
            throw new TypeError(`assertType error: First argument must be an object wrapper.`);
        if (typeof expectedType !== 'string' && typeof expectedType !== 'function')
            throw new TypeError(`assertType error: Expected type must be a string or class definition.`);

        const entries = Object.entries(argObj);
        if (entries.length === 0)
            throw new Error(`assertType error: Object wrapper must contain at least one variable.`);

        for (const [paramName, value] of entries) {
            const actualType = Object.prototype.toString.call(value).slice(8, -1).toLowerCase();

            if (typeof expectedType === 'function') {
                if (value instanceof expectedType) return;
            } else {
                if (actualType === expectedType.toLowerCase()) return;
            }

            // Doesn't match, throw TypeError
            const stack = new Error().stack;
            let callerName = 'anonymous';

            if (stack) {
                const lines = stack.split('\n');
                // line 0: Error, line 1: assertType, line 2: the caller function
                const callerLine = lines[2];
                if (callerLine) {
                    // Match standard formats like "at functionName (" or "at Object.functionName ("
                    const match = callerLine.match(/at\s+(?:Object\.)?([^\s(]+)/);
                    if (match && match[1])
                        callerName = match[1].split('.').pop(); // Strip namespaces if present
                }
            }

            const expectedTypeStr = typeof expectedType === 'function' ? `an instance of ${expectedType.name}` : `a ${expectedType}`;
            const gotTypeStr = typeof expectedType === 'function' ? `an instnace of ${value?.constructor?.name ?? 'Unknown'}` : `${actualType} (${value})`;
            throw new TypeError(
                `${callerName}: "${paramName}" must be ${expectedTypeStr}. Got: ${gotTypeStr}`
            );
        }
    }
}