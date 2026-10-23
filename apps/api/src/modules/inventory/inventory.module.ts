import { Module } from '@nestjs/common';
import { EquivalencesController } from './equivalences.controller';
import { EquivalencesService } from './equivalences.service';
import { ProductCommandsService } from './product-commands.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StockQueriesService } from './stock-queries.service';

@Module({
  controllers: [ProductsController, EquivalencesController],
  providers: [ProductsService, ProductCommandsService, EquivalencesService, StockQueriesService],
})
export class InventoryModule {}
