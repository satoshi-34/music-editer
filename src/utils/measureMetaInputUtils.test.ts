import { describe, expect, it } from 'vitest';
import {
  parseTimeSignatureInput,
  parseBpmInput,
  parseRehearsalInput,
  parseClefInput,
  parseKeySigInput,
  parseSymbolScaleInput,
  parseSymbolOffsetInput,
} from './measureMetaInputUtils';

describe('parseTimeSignatureInput', () => {
  it('"none"は解除(undefined)', () => {
    expect(parseTimeSignatureInput('none')).toBeUndefined();
  });
  it('空文字は解除(undefined)', () => {
    expect(parseTimeSignatureInput('')).toBeUndefined();
  });
  it('"4/4"は[4,4]になる', () => {
    expect(parseTimeSignatureInput('4/4')).toEqual([4, 4]);
  });
  it('"6/8"は[6,8]になる', () => {
    expect(parseTimeSignatureInput('6/8')).toEqual([6, 8]);
  });
  it('不正な形式は解除(undefined)', () => {
    expect(parseTimeSignatureInput('abc')).toBeUndefined();
    expect(parseTimeSignatureInput('4/4/4')).toBeUndefined();
  });
});

describe('parseBpmInput', () => {
  it('60〜240の範囲は有効', () => {
    expect(parseBpmInput('120')).toBe(120);
    expect(parseBpmInput('60')).toBe(60);
    expect(parseBpmInput('240')).toBe(240);
  });
  it('範囲外は undefined', () => {
    expect(parseBpmInput('59')).toBeUndefined();
    expect(parseBpmInput('241')).toBeUndefined();
  });
  it('空欄・非数値は undefined', () => {
    expect(parseBpmInput('')).toBeUndefined();
    expect(parseBpmInput('abc')).toBeUndefined();
  });
});

describe('parseRehearsalInput', () => {
  it('有効な文字列はそのまま返す', () => {
    expect(parseRehearsalInput('A')).toBe('A');
  });
  it('前後空白はtrimされる', () => {
    expect(parseRehearsalInput('  B  ')).toBe('B');
  });
  it('空欄はundefined', () => {
    expect(parseRehearsalInput('   ')).toBeUndefined();
  });
  it('無効な文字列はundefined', () => {
    expect(parseRehearsalInput('*****')).toBeUndefined();
  });
});

describe('parseClefInput', () => {
  it('treble/bass/alto/tenorは有効', () => {
    expect(parseClefInput('treble')).toBe('treble');
    expect(parseClefInput('bass')).toBe('bass');
    expect(parseClefInput('alto')).toBe('alto');
    expect(parseClefInput('tenor')).toBe('tenor');
  });
  it('それ以外・空欄・noneはundefined', () => {
    expect(parseClefInput('none')).toBeUndefined();
    expect(parseClefInput('')).toBeUndefined();
    expect(parseClefInput('soprano')).toBeUndefined();
  });
});

describe('parseKeySigInput', () => {
  it('有効な調号はそのまま返す', () => {
    expect(parseKeySigInput('C')).toBe('C');
    expect(parseKeySigInput('F')).toBe('F');
  });
  it('空欄・無効値はundefined', () => {
    expect(parseKeySigInput('')).toBeUndefined();
    expect(parseKeySigInput('Z')).toBeUndefined();
  });
});

describe('parseSymbolScaleInput', () => {
  it('空欄は100%(1倍)扱い', () => {
    expect(parseSymbolScaleInput('')).toBe(1);
  });
  it('"120"は1.2倍になる', () => {
    expect(parseSymbolScaleInput('120')).toBeCloseTo(1.2);
  });
  it('非数値は100%(1倍)扱い', () => {
    expect(parseSymbolScaleInput('abc')).toBe(1);
  });
  it('範囲外は境界値にクランプされる', () => {
    expect(parseSymbolScaleInput('1000')).toBe(4); // MAX_SYMBOL_SCALE
    expect(parseSymbolScaleInput('1')).toBe(0.25); // MIN_SYMBOL_SCALE
  });
});

describe('parseSymbolOffsetInput', () => {
  it('空欄は0扱い', () => {
    expect(parseSymbolOffsetInput('')).toBe(0);
  });
  it('数値はそのまま反映される', () => {
    expect(parseSymbolOffsetInput('10')).toBe(10);
    expect(parseSymbolOffsetInput('-10')).toBe(-10);
  });
  it('非数値は0扱い', () => {
    expect(parseSymbolOffsetInput('abc')).toBe(0);
  });
  it('範囲外は境界値にクランプされる', () => {
    expect(parseSymbolOffsetInput('1000')).toBe(100); // MAX_SYMBOL_OFFSET
    expect(parseSymbolOffsetInput('-1000')).toBe(-100); // MIN_SYMBOL_OFFSET
  });
});
