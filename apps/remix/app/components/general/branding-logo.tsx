import type { ImgHTMLAttributes } from 'react';

import Logo from '@documenso/assets/logo.png';

export type LogoProps = ImgHTMLAttributes<HTMLImageElement>;

export const BrandingLogo = ({ className, ...props }: LogoProps) => {
  return <img src={Logo} alt="Sign8" className={className} {...props} />;
};
