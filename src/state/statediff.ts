import * as _ from 'lodash'
function stateDiff<P extends Array<any> | Object,N extends Array<any> | Object>(previous: P, newState: N): any {
    if (newState) {
        if (_.isArray(newState)) {
            if (!_.isEqual(previous,newState)){
                return newState;
            }
        } else {
            const ret = {};
            _.map(newState, (newValue, key) => {
                const prevValue = previous ? previous[key] : undefined;
                if (_.isObject(newValue)) {
                    if (prevValue !== newValue) {
                        const childObj = stateDiff(prevValue, newValue);
                        if (childObj === null) {
                            ret[key] = childObj;
                        } else if (childObj && !_.isEmpty(childObj)) {
                            ret[key] = childObj;
                        }
                    }
                } else {
                    if (newValue != prevValue) {
                        ret[key] = newValue;
                    }
                }
            })
            if (!_.isEmpty(ret)) {
                return ret;
            }
            return undefined;
        }
    } else {
        return newState;
    }
}

export default stateDiff;