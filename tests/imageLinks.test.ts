import { describe, it, expect } from 'vitest';
import { linkPathAt } from '../src/crop/imageLinks';

describe('linkPathAt', () => {
  it('finds a wiki embed under the cursor, without size or heading', () => {
    const line = 'Before ![[Photos/cat pic.png|300]] after';
    expect(linkPathAt(line, 12)).toBe('Photos/cat pic.png');
    expect(linkPathAt(line, 2)).toBeNull();
  });

  it('finds a Markdown embed and decodes it', () => {
    const line = '![a cat](Photos/cat%20pic.jpg "title") and ![[other.png]]';
    expect(linkPathAt(line, 3)).toBe('Photos/cat pic.jpg');
    expect(linkPathAt(line, line.length - 3)).toBe('other.png');
  });

  it('handles angle-bracket Markdown paths', () => {
    expect(linkPathAt('![](<my folder/a b.webp>)', 5)).toBe('my folder/a b.webp');
  });

  it('ignores external URLs', () => {
    expect(linkPathAt('![x](https://example.com/a.png)', 5)).toBeNull();
  });
});
