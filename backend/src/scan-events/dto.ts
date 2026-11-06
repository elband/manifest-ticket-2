import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

// F-08: status hasil scan yang sah (validasi enum, jangan terima string bebas).
const RESULT_STATUSES = [
  "INVALID_BARCODE",
  "UNKNOWN_FLIGHT",
  "FLIGHT_NOT_TODAY",
  "FLIGHT_NOT_ACTIVE",
  "DUPLICATE_SCAN",
  "VALID_FLIGHT",
  "KTP_MISMATCH",
] as const;

export class PushScanDto {
  @ApiProperty({ description: "Client-generated UUID for idempotency" })
  @IsString()
  @MaxLength(64)
  // F-10: cegah path-traversal — eventId dipakai sebagai nama file foto.
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "eventId hanya boleh huruf, angka, '-' dan '_'.",
  })
  eventId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  rawBarcode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flightNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pnr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ticketNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  passengerName?: string;

  @ApiProperty({ enum: RESULT_STATUSES })
  @IsIn(RESULT_STATUSES)
  resultStatus!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({ example: "2026-06-12T08:30:00.000Z" })
  @IsDateString()
  scannedAt!: string;

  @ApiProperty({ example: "CGK-T3" })
  @IsString()
  @MaxLength(32)
  station!: string;

  @ApiPropertyOptional({
    description:
      "Petugas yang melakukan scan — WAJIB bila dikirim dengan token perangkat; " +
      "diabaikan untuk token petugas (pelaku = pemilik token).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  operatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ktpStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ktpName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ktpSimilarity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  ktpCapturedAt?: string;
}

/** Keputusan petugas setelah membandingkan nama di card dengan KTP/SIM. */
export class IdentityDecisionDto {
  @ApiProperty({ description: "true = identitas sesuai boarding pass" })
  @IsBoolean()
  match!: boolean;

  @ApiProperty({ example: "2026-06-12T08:30:10.000Z" })
  @IsDateString()
  decidedAt!: string;

  @ApiPropertyOptional({
    description:
      "true = sesuai otomatis (card tertimpa scan berikutnya tanpa ditolak petugas)",
  })
  @IsOptional()
  @IsBoolean()
  auto?: boolean;
}

export class ListScansQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  station?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flightNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resultStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  perPage?: number;
}
