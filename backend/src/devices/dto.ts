import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

/** Secret 256-bit (base64url) buatan perangkat; disimpan server hanya sebagai hash. */
const SECRET_RULE = /^[A-Za-z0-9_-]{43,128}$/;

export class DeviceSecretDto {
  @ApiProperty({ description: "Secret acak perangkat (base64url, ≥ 256 bit)" })
  @IsString()
  @Matches(SECRET_RULE, { message: "Secret perangkat tidak valid" })
  secret!: string;
}

export class RegisterDeviceDto extends DeviceSecretDto {
  @ApiPropertyOptional({ example: "Kiosk SCP 1" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class ApproveDeviceDto {
  @ApiPropertyOptional({ example: "Kiosk SCP 1" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: "SCP1", description: "Station/pos tempat perangkat bertugas" })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  station!: string;
}

export class UpdateDeviceDto {
  @ApiPropertyOptional({ example: "Kiosk SCP 1" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: "SCP1" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  station?: string;
}
