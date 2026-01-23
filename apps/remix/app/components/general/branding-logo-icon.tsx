import type { ImgHTMLAttributes } from 'react';

import LogoIcon from '@documenso/assets/logo_icon.png';

export type LogoProps = ImgHTMLAttributes<HTMLImageElement>;

export const BrandingLogoIcon = ({ className, ...props }: LogoProps) => {
  return <img src={LogoIcon} alt="Sign8" className={className} {...props} />;
};
