import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { ROLES, Role } from "../common/roles";

export class CreateOperatorDto {
  @ApiProperty({ example: "Andi Saputra" })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: "andi@afvs.local",
    description: "Opsional — auto-generate dari nama bila kosong.",
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: ROLES, example: "operator" })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({ example: "SCP2" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  station?: string;

  @ApiPropertyOptional({
    example: "123456",
    description: "PIN 4-6 digit. Kosongkan untuk PIN acak.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: "PIN harus 4-6 digit angka" })
  pin?: string;

  @ApiPropertyOptional({
    description: "Password login email. Kosongkan untuk password acak kuat.",
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateOperatorDto {
  @ApiPropertyOptional({ example: "Andi Saputra" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: "andi@afvs.local" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({ example: "SCP2" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  station?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SetPinDto {
  @ApiPropertyOptional({
    example: "123456",
    description: "PIN 4-6 digit. Kosongkan untuk PIN acak.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: "PIN harus 4-6 digit angka" })
  pin?: string;
}

export class ListOperatorsQuery {
  @ApiPropertyOptional({ example: "SCP2" })
  @IsOptional()
  @IsString()
  station?: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({ description: "Cari nama / email" })
  @IsOptional()
  @IsString()
  q?: string;
}

/** Petugas mengubah profil sendiri — hanya nama & email. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: "Andi Saputra" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: "andi@afvs.local" })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class ChangeOwnPinDto {
  @ApiProperty({ example: "123456" })
  @IsString()
  @Matches(/^\d{4,6}$/, { message: "PIN lama harus 4-6 digit angka" })
  currentPin!: string;

  @ApiProperty({ example: "482915" })
  @IsString()
  @Matches(/^\d{4,6}$/, { message: "PIN baru harus 4-6 digit angka" })
  newPin!: string;
}
