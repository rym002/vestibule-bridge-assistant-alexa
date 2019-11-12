import 'mocha'
import stateDiff from '../src/state/statediff'
import { expect } from 'chai'

describe('statediff', () => {
    const o1 = {
        'b1': true,
        'n1': 123,
        's1': 's1v',
        'a1': [
            123
        ],
        'o1': {
            's11': 's11v'
        }
    }
    it('should diff booleans', () => {

        const o2 = {
            'b1': false,
            'n1': 123,
            's1': 's1v'
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('b1')
            .to.eql(false)
        expect(delta)
            .to.not.have.property('n1')
        expect(delta)
            .to.not.have.property('s1')
        expect(delta)
            .to.not.have.property('a1')
        expect(delta)
            .to.not.have.property('o1')
    })
    it('should diff numbers', () => {
        const o2 = {
            'b1': true,
            'n1': 456,
            's1': 's1v'
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('n1')
            .to.eql(456)
        expect(delta)
            .to.not.have.property('b1')
        expect(delta)
            .to.not.have.property('s1')
        expect(delta)
            .to.not.have.property('a1')
        expect(delta)
            .to.not.have.property('o1')
    })
    it('should diff strings', () => {
        const o2 = {
            'b1': true,
            'n1': 123,
            's1': 'newvalue'
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('s1')
            .to.eql('newvalue')
        expect(delta)
            .to.not.have.property('b1')
        expect(delta)
            .to.not.have.property('n1')
        expect(delta)
            .to.not.have.property('a1')
        expect(delta)
            .to.not.have.property('o1')
    })

    it('should ignore like arrays', () => {
        const o2 = {
            'b1': true,
            'n1': 123,
            's1': 's1v',
            's2': 'string',
            'a1': [
                123
            ]
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('s2')
            .to.eql('string')
        expect(delta)
            .to.not.have.property('s1')
        expect(delta)
            .to.not.have.property('b1')
        expect(delta)
            .to.not.have.property('n1')
        expect(delta)
            .to.not.have.property('a1')
        expect(delta)
            .to.not.have.property('o1')
    })
    it('should return changed arrays', () => {
        const o2 = {
            'b1': true,
            'n1': 123,
            's1': 's1v',
            'a1': [
                123,
                456
            ]
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('a1')
            .to.have.length(2)
        expect(delta)
            .to.not.have.property('s1')
        expect(delta)
            .to.not.have.property('b1')
        expect(delta)
            .to.not.have.property('n1')
        expect(delta)
            .to.not.have.property('o1')
    })

    it('should return undefined', () => {
        const o2 = {
            'b1': true,
            'n1': 123,
            's1': undefined,
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.be.undefined
    })
    it('should return null', () => {
        const o2 = {
            'b1': true,
            'n1': 123,
            's1': null,
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('s1')
            .to.be.null
        expect(delta)
            .to.not.have.property('b1')
        expect(delta)
            .to.not.have.property('n1')
        expect(delta)
            .to.not.have.property('a1')
        expect(delta)
            .to.not.have.property('o1')
    })
    it('should return nested diff', () => {
        const o2 = {
            'o1': {
                's11': 'newvalue'
            },
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('o1')
            .to.eql({
                's11': 'newvalue'
            })
        expect(delta)
            .to.not.have.property('b1')
        expect(delta)
            .to.not.have.property('n1')
        expect(delta)
            .to.not.have.property('a1')
    })
    it('should return undefined on nested match', () => {
        const o2 = {
            'o1': {
                's11': 's11v'
            },
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.be.undefined
    })
    it('should return null nested object', () => {
        const o2 = {
            'o1': null,
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.have.property('o1')
            .to.be.null
    })
    it('should return undefined nested object if nested object is undefined', () => {
        const o2 = {
            'o1': undefined,
        }
        const delta = stateDiff(o1, o2);
        expect(delta)
            .to.be.undefined
    })
})