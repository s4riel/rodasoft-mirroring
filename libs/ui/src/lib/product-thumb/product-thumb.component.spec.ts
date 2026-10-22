import { TestBed } from '@angular/core/testing';
import { ProductThumbComponent } from './product-thumb.component';

describe('ProductThumbComponent', () => {
  it('shows the photo when there is one and the glyph otherwise', () => {
    const fixture = TestBed.createComponent(ProductThumbComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('rs-icon')).not.toBeNull();

    fixture.componentRef.setInput('src', 'https://img.test/p.png');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('https://img.test/p.png');
    expect(fixture.nativeElement.querySelector('rs-icon')).toBeNull();
  });
});
