import { isArray, isEqual, isEmpty, isObject, forEach } from 'lodash'
function stateDiff<P extends Array<any> | Object, N extends Array<any> | Object>(previous: P, newState: N): any {
    if (newState) {
        if (isArray(newState)) {
            if (!isEqual(previous, newState)) {
                return newState;
            }
        } else {
            const ret = {};
            forEach(newState, (newValue, key) => {
                const prevValue = previous ? previous[key] : undefined;
                if (isObject(newValue)) {
                    if (!isEqual(prevValue, newValue)) {
                        const childObj = stateDiff(prevValue, newValue);
                        if (childObj === null || (childObj && !isEmpty(childObj))) {
                            ret[key] = childObj;
                        }
                    }
                } else {
                    if (newValue !== prevValue) {
                        ret[key] = newValue;
                    }
                }
            })
            if (!isEmpty(ret)) {
                return ret;
            }
            return undefined;
        }
    } else {
        return newState;
    }
}

export default stateDiff;