import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The shape every error response takes, applied by `AllExceptionsFilter`.
 *
 * Documentation only — nothing constructs this. Success payloads are
 * deliberately NOT enveloped; only errors carry this wrapper.
 */
export class ErrorResponse {
  @ApiProperty({
    description: 'Always false. Present so clients can branch without checking status.',
    example: false,
  })
  success!: false;

  @ApiProperty({ description: 'The HTTP status code, repeated in the body.', example: 401 })
  statusCode!: number;

  @ApiProperty({
    description: 'A human-readable summary of what went wrong.',
    example: 'Unauthorized',
  })
  message!: string;

  @ApiPropertyOptional({
    description:
      'Field-level detail, present only for structured failures such as validation. Absent entirely for a plain error.',
    example: ['userId: Invalid uuid'],
    type: [String],
  })
  errors?: string[];
}
